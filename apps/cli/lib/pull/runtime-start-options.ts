/**
 * Translates reprint's output (blueprint.json, start.json, runtime.php) into
 * the StartServerOptions that Playground CLI expects. This is the bridge
 * between reprint's view of the imported site and Studio's server startup.
 */
import fs from 'fs';
import path from 'path';
import { loadNodeRuntime } from '@php-wasm/node';
import { PHP, ProcessIdAllocator } from '@php-wasm/universal';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { getContentDirFromState } from 'cli/lib/pull/reprint-state';
import { installSqliteIntegration } from 'cli/lib/sqlite-integration';
import { LoggerError } from 'cli/logger';
import type { Blueprint } from '@wp-playground/blueprints';
import type { StartServerOptions } from 'cli/lib/wordpress-server-manager';

const phpProcessIdAllocator = new ProcessIdAllocator();

function filterExistingMounts(
	mounts: Array< { hostPath: string; vfsPath: string } >
): Array< { hostPath: string; vfsPath: string } > {
	return mounts.filter( ( mount ) => fs.existsSync( mount.hostPath ) );
}

type RuntimeConstantValue = string | number | boolean;
type BlueprintWithConstants = Blueprint & {
	constants?: Record< string, RuntimeConstantValue >;
};

/**
 * Extract user-defined constants from a runtime.php file by including it
 * in a fresh PHP WASM instance. This lets PHP's own parser handle the
 * syntax — no regex approximation of define() calls, string escaping,
 * or scalar value decoding.
 */
async function parseRuntimePhpConstants(
	runtimePhpContent: string
): Promise< Record< string, RuntimeConstantValue > > {
	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		emscriptenOptions: {
			processId: phpProcessIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		php.writeFile( '/tmp/runtime.php', runtimePhpContent );
		php.writeFile(
			'/tmp/extract-constants.php',
			`<?php
$before = get_defined_constants( true )['user'] ?? [];
include '/tmp/runtime.php';
$after = get_defined_constants( true )['user'] ?? [];
echo json_encode( array_diff_key( $after, $before ) );
`
		);

		const response = await php.cli( [ 'php', '/tmp/extract-constants.php' ] );
		// Buffering is safe here: the output is a single JSON object
		// containing only user-defined PHP constants from runtime.php,
		// typically a handful of key-value pairs — not an unbounded stream.
		const stdoutChunks: string[] = [];
		const reader = response.stdout.getReader();
		const decoder = new TextDecoder();

		while ( true ) {
			const { done, value } = await reader.read();
			if ( done ) {
				break;
			}
			if ( value ) {
				stdoutChunks.push( decoder.decode( value, { stream: true } ) );
			}
		}

		const exitCode = await response.exitCode;
		if ( exitCode !== 0 ) {
			return {};
		}

		const parsed = JSON.parse( stdoutChunks.join( '' ).trim() ) as Record< string, unknown >;
		const constants: Record< string, RuntimeConstantValue > = {};
		for ( const [ key, val ] of Object.entries( parsed ) ) {
			if ( typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ) {
				constants[ key ] = val;
			}
		}
		return constants;
	} finally {
		php.exit();
	}
}

function getMountedWordPressPathConstants(
	mountsBeforeInstall: Array< { hostPath: string; vfsPath: string } >,
	mounts: Array< { hostPath: string; vfsPath: string } >
): Record< string, string > {
	const allMounts = [ ...mountsBeforeInstall, ...mounts ];
	const wpContentMount = allMounts.find( ( mount ) => mount.vfsPath === '/wordpress/wp-content' );

	if ( ! wpContentMount ) {
		return {};
	}

	return {
		WP_CONTENT_DIR: '/wordpress/wp-content',
		WP_PLUGIN_DIR: '/wordpress/wp-content/plugins',
		WPMU_PLUGIN_DIR: '/wordpress/wp-content/mu-plugins',
	};
}

function mergeBlueprintConstants(
	blueprint: Blueprint,
	constants: Record< string, RuntimeConstantValue >
): Blueprint {
	if ( Object.keys( constants ).length === 0 ) {
		return blueprint;
	}

	const blueprintWithConstants = blueprint as BlueprintWithConstants;

	return {
		...blueprintWithConstants,
		constants: {
			...( blueprintWithConstants.constants ?? {} ),
			...constants,
		},
	};
}

/**
 * Returns the real wp-content directory for an imported site.
 *
 * The flattened site directory may contain a wp-content symlink that uses
 * VFS-relative paths (e.g. ../fs-root/srv/htdocs/wp-content) which don't
 * resolve on the host filesystem.  Instead of traversing that symlink, we
 * derive the real path from the import's raw directory and the content_dir
 * recorded in the reprint preflight state.
 */
function resolveImportedWpContentPath( runtimeBlueprintPath: string ): string {
	const importRoot = path.dirname( path.dirname( runtimeBlueprintPath ) );
	const rawDirectory = path.join( importRoot, 'raw' );
	const stateDirectory = path.join( importRoot, 'state' );

	const contentDir = getContentDirFromState( stateDirectory );
	if ( contentDir ) {
		const resolved = path.join( rawDirectory, contentDir.replace( /^\//, '' ) );
		if ( fs.existsSync( resolved ) ) {
			return resolved;
		}
	}

	return path.join( rawDirectory, 'wp-content' );
}

export async function ensureImportedSiteSqliteReady(
	runtimeBlueprintPath: string
): Promise< string > {
	const wpContentPath = resolveImportedWpContentPath( runtimeBlueprintPath );
	const databaseDirectory = path.join( wpContentPath, 'database' );
	const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );
	const sqlitePhpPath = path.join( databaseDirectory, '.ht.sqlite.php' );

	// reprint downloads the database as `.ht.sqlite.php` because some
	// hosting environments serve `.sqlite` files directly over HTTP.
	// Playground expects `.ht.sqlite`, so rename on first access.
	if ( ! fs.existsSync( sqlitePath ) && fs.existsSync( sqlitePhpPath ) ) {
		fs.renameSync( sqlitePhpPath, sqlitePath );
	}

	await installSqliteIntegration( path.dirname( wpContentPath ) );
	return sqlitePath;
}

export function loadImportedRuntimeStartOptionsNative(
	technicalSiteDirectory: string,
	runtimeDirectory: string
): StartServerOptions {
	const runtimePhpPath = path.join( runtimeDirectory, 'runtime.php' );
	if ( ! fs.existsSync( runtimePhpPath ) ) {
		throw new LoggerError(
			`Missing runtime.php at ${ runtimePhpPath }. Re-run \`studio pull-reprint\` to regenerate the runtime configuration.`
		);
	}

	return {
		autoPrependFile: runtimePhpPath,
		openBasedirAllowList: [ technicalSiteDirectory ],
	};
}

export function loadRuntimeBlueprint( runtimeBlueprintPath: string ): Blueprint {
	if ( ! fs.existsSync( runtimeBlueprintPath ) ) {
		throw new LoggerError( `Runtime Blueprint not found: ${ runtimeBlueprintPath }` );
	}

	try {
		return JSON.parse( fs.readFileSync( runtimeBlueprintPath, 'utf-8' ) ) as Blueprint;
	} catch ( error ) {
		throw new LoggerError( `Failed to parse runtime Blueprint: ${ runtimeBlueprintPath }`, error );
	}
}

export async function loadImportedRuntimeStartOptions(
	runtimeBlueprintPath: string
): Promise< StartServerOptions > {
	const runtimeDirectory = path.dirname( runtimeBlueprintPath );
	const startJsonPath = path.join( runtimeDirectory, 'start.json' );
	const runtimePhpPath = path.join( runtimeDirectory, 'runtime.php' );

	let blueprint = loadRuntimeBlueprint( runtimeBlueprintPath );
	const startOptions: StartServerOptions = {
		blueprint,
		blueprintUri: runtimeBlueprintPath,
	};

	if ( ! fs.existsSync( startJsonPath ) ) {
		throw new LoggerError(
			`Missing runtime start.json at ${ startJsonPath }. Re-run \`studio pull-reprint\` to regenerate the runtime configuration.`
		);
	}

	// start.json mounts can reference paths that don't exist on the host:
	// /internal/symlinks/ entries from PHP WASM's followSymlinks mode.
	// When PHP WASM resolves a host symlink, it maps the target through
	// /internal/symlinks/<absolute-host-path-without-leading-slash>.
	// These paths work inside WASM but don't exist on the host.
	function resolveVfsMountPath( mount: { hostPath: string; vfsPath: string } ) {
		// Playground's --follow-symlinks resolves symlinks that point
		// outside the mounted tree to /internal/symlinks/{host_path}.
		// Strip the prefix to recover the real host filesystem path.
		const INTERNAL_SYMLINKS_PREFIX = '/internal/symlinks/';
		if ( mount.hostPath.startsWith( INTERNAL_SYMLINKS_PREFIX ) ) {
			return {
				hostPath: '/' + mount.hostPath.slice( INTERNAL_SYMLINKS_PREFIX.length ),
				vfsPath: mount.vfsPath,
			};
		}

		return mount;
	}

	const startConfig = JSON.parse( fs.readFileSync( startJsonPath, 'utf-8' ) ) as {
		mounts_before_install?: Array< { source: string; target: string } >;
		mounts?: Array< { source: string; target: string } >;
		wordpress_install_mode?: string;
	};
	const rawMountsBeforeInstall: Array< { hostPath: string; vfsPath: string } > = (
		startConfig.mounts_before_install ?? []
	).map( ( m ) => ( {
		hostPath: m.source,
		vfsPath: m.target,
	} ) );
	const rawMounts: Array< { hostPath: string; vfsPath: string } > = (
		startConfig.mounts ?? []
	).map( ( m ) => ( {
		hostPath: m.source,
		vfsPath: m.target,
	} ) );
	const wordpressInstallMode =
		startConfig.wordpress_install_mode as StartServerOptions[ 'wordpressInstallMode' ];

	const mountsBeforeInstall = filterExistingMounts(
		rawMountsBeforeInstall.map( resolveVfsMountPath )
	);
	const mounts = filterExistingMounts( rawMounts.map( resolveVfsMountPath ) );

	if ( mountsBeforeInstall.length > 0 ) {
		startOptions.mountsBeforeInstall = mountsBeforeInstall;
	}

	if ( mounts.length > 0 ) {
		startOptions.mounts = mounts;
	}

	if ( wordpressInstallMode ) {
		startOptions.wordpressInstallMode = wordpressInstallMode;
	}

	const runtimeConstants = {
		...getMountedWordPressPathConstants( mountsBeforeInstall, mounts ),
		...( fs.existsSync( runtimePhpPath )
			? await parseRuntimePhpConstants( fs.readFileSync( runtimePhpPath, 'utf-8' ) )
			: {} ),
	};
	if ( Object.keys( runtimeConstants ).length > 0 ) {
		blueprint = mergeBlueprintConstants( blueprint, runtimeConstants );
		startOptions.blueprint = blueprint;
	}

	// On wp.com Atomic, auto_prepend_file points to /scripts/env.php —
	// a directory outside the WordPress roots that the importer's
	// apply-runtime doesn't mount.  Detect it from the importer state
	// and add the mount so absolute paths like
	// require_once('/scripts/object-cache.memcache.php') resolve.
	const extraDirMounts = getExtraDirectoryMountsFromImporterState( runtimeDirectory );
	if ( extraDirMounts.length > 0 ) {
		startOptions.mountsBeforeInstall = [
			...( startOptions.mountsBeforeInstall ?? [] ),
			...extraDirMounts,
		];
	}

	// Managed hosts inject DB credentials at the server level, so the
	// exported wp-config.php often doesn't define them.  Without DB_NAME,
	// WordPress redirects to setup-config.php before the SQLite drop-in
	// gets a chance to load.  Playground injects blueprint constants via
	// auto_prepend_file, so they're defined before wp-config.php runs.
	// The actual values don't matter — the SQLite drop-in ignores them.
	const dbPlaceholders: Record< string, string > = {
		DB_NAME: 'wordpress',
		DB_USER: 'wordpress',
		DB_PASSWORD: 'wordpress',
		DB_HOST: 'localhost',
	};
	const blueprintConstants = ( blueprint as BlueprintWithConstants ).constants ?? {};
	const missingDbConstants: Record< string, string > = {};
	for ( const [ key, value ] of Object.entries( dbPlaceholders ) ) {
		if ( ! ( key in blueprintConstants ) ) {
			missingDbConstants[ key ] = value;
		}
	}
	if ( Object.keys( missingDbConstants ).length > 0 ) {
		blueprint = mergeBlueprintConstants( blueprint, missingDbConstants );
		startOptions.blueprint = blueprint;
	}

	startOptions.skipSqliteSetup = true;
	startOptions.useExactMountLayout = true;

	return startOptions;
}

/**
 * Reads the importer state to find directories that need mounting at their
 * original absolute paths (e.g. /scripts from auto_prepend_file).  These
 * directories are downloaded into the raw/ tree but aren't in the flattened
 * site path or the generated start.json.
 */
export function getExtraDirectoryMountsFromImporterState(
	runtimeDirectory: string
): Array< { hostPath: string; vfsPath: string } > {
	const importRoot = path.dirname( runtimeDirectory );
	const statePath = path.join( importRoot, 'state', '.import-state.json' );
	const rawDirectory = path.join( importRoot, 'raw' );

	let raw: string;
	try {
		raw = fs.readFileSync( statePath, 'utf-8' );
	} catch {
		// State file may not exist yet.
		return [];
	}

	let state: Record< string, unknown >;
	try {
		state = JSON.parse( raw ) as Record< string, unknown >;
	} catch {
		// Malformed state file — skip extra mounts rather than crashing.
		return [];
	}

	const preflight = ( state.preflight as Record< string, unknown > | undefined )?.data as
		| Record< string, unknown >
		| undefined;
	const runtime = preflight?.runtime as Record< string, unknown > | undefined;
	const iniGetAll = runtime?.ini_get_all as Record< string, unknown > | undefined;
	const autoPrepend = iniGetAll?.auto_prepend_file;

	if ( typeof autoPrepend !== 'string' || ! autoPrepend.startsWith( '/' ) ) {
		return [];
	}

	const dir = path.posix.dirname( autoPrepend );
	if ( ! dir || dir === '/' ) {
		return [];
	}

	// The raw download preserves full remote paths, so /scripts
	// becomes raw/scripts on the host filesystem.
	const hostPath = path.join( rawDirectory, dir.slice( 1 ) );
	const resolvedHostPath = path.resolve( hostPath );
	const resolvedRawDirectory = path.resolve( rawDirectory );
	if ( ! resolvedHostPath.startsWith( resolvedRawDirectory + path.sep ) ) {
		return [];
	}
	if ( ! fs.existsSync( hostPath ) ) {
		return [];
	}

	return [ { hostPath, vfsPath: dir } ];
}
