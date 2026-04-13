/**
 * Translates reprint's output (blueprint.json, start.sh, runtime.php) into
 * the StartServerOptions that Playground CLI expects. This is the bridge
 * between reprint's view of the imported site and Studio's server startup.
 */
import fs from 'fs';
import path from 'path';
import { loadNodeRuntime } from '@php-wasm/node';
import { PHP, ProcessIdAllocator } from '@php-wasm/universal';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { installSqliteIntegration } from 'cli/lib/sqlite-integration';
import { LoggerError } from 'cli/logger';
import type { Blueprint } from '@wp-playground/blueprints';
import type { StartServerOptions } from 'cli/lib/wordpress-server-manager';

const phpProcessIdAllocator = new ProcessIdAllocator();

const SHELL_ARG_RE = ( flag: string ) =>
	new RegExp( `--${ flag }=(?:'([^']*)'|"([^"]*)"|([^\\s\\\\]+))`, 'g' );

function getShellFlagValues( content: string, flag: string ): string[] {
	return Array.from(
		content.matchAll( SHELL_ARG_RE( flag ) ),
		( match ) => match[ 1 ] ?? match[ 2 ] ?? match[ 3 ] ?? ''
	).filter( Boolean );
}

function parseMountSpec( mountSpec: string ): { hostPath: string; vfsPath: string } {
	const match = mountSpec.match( /^(.*):(\/.*)$/ );
	if ( ! match ) {
		throw new LoggerError( `Invalid runtime mount spec: ${ mountSpec }` );
	}

	return {
		hostPath: match[ 1 ],
		vfsPath: match[ 2 ],
	};
}

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
 * VFS-relative paths (e.g. ../docroot/srv/htdocs/wp-content) which don't
 * resolve on the host filesystem.  Instead of traversing that symlink, we
 * derive the real path from the import's raw directory and the content_dir
 * recorded in the import state during preflight.
 *
 * Falls back to sitePath/wp-content for non-imported sites or when the
 * import state doesn't specify a content_dir.
 */
function resolveImportedWpContentPath( runtimeBlueprintPath: string ): string {
	const importRoot = path.dirname( path.dirname( runtimeBlueprintPath ) );
	const rawDirectory = path.join( importRoot, 'raw' );
	const statePath = path.join( importRoot, 'state', '.import-state.json' );

	if ( fs.existsSync( statePath ) ) {
		try {
			const state = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) as Record<
				string,
				unknown
			>;
			const preflight = ( state.preflight as Record< string, unknown > | undefined )?.data as
				| Record< string, unknown >
				| undefined;
			const contentDir = ( preflight?.paths_urls as Record< string, unknown > | undefined )
				?.content_dir;

			if ( typeof contentDir === 'string' && contentDir.startsWith( '/' ) ) {
				const resolved = path.join( rawDirectory, contentDir.slice( 1 ) );
				if ( fs.existsSync( resolved ) ) {
					return resolved;
				}
			}
		} catch {
			// Fall through to the default path.
		}
	}

	// Fallback: find the wp-content directory that contains the imported
	// database.  There may be multiple wp-content directories in the raw
	// tree (e.g. one at the WordPress root and one inside the docroot),
	// so the database subdirectory disambiguates.
	const candidates: string[] = [];
	function findWpContentDirs( dir: string, depth = 0 ): void {
		if ( depth > 5 ) {
			return;
		}
		let entries;
		try {
			entries = fs.readdirSync( dir, { withFileTypes: true } );
		} catch {
			return;
		}
		for ( const entry of entries ) {
			if ( entry.name === 'wp-content' && entry.isDirectory() ) {
				candidates.push( path.join( dir, entry.name ) );
			} else if ( entry.isDirectory() && ! entry.isSymbolicLink() ) {
				findWpContentDirs( path.join( dir, entry.name ), depth + 1 );
			}
		}
	}
	findWpContentDirs( rawDirectory );

	// Prefer the wp-content that has the imported database.
	const withDatabase = candidates.find( ( c ) =>
		fs.existsSync( path.join( c, 'database', '.ht.sqlite' ) )
	);
	if ( withDatabase ) {
		return withDatabase;
	}

	return candidates[ 0 ] ?? path.join( rawDirectory, 'wp-content' );
}

/**
 * Returns the path to the imported SQLite database, renaming it if needed.
 *
 * reprint downloads the database as `.ht.sqlite.php` because some hosting
 * environments serve `.sqlite` files directly over HTTP.  The `.php`
 * extension prevents that.  Playground expects `.ht.sqlite`, so we rename
 * it on first access.
 */
export function normalizeImportedSqliteDatabasePath( runtimeBlueprintPath: string ): string {
	const wpContentPath = resolveImportedWpContentPath( runtimeBlueprintPath );
	const databaseDirectory = path.join( wpContentPath, 'database' );
	const sqlitePath = path.join( databaseDirectory, '.ht.sqlite' );
	const sqlitePhpPath = path.join( databaseDirectory, '.ht.sqlite.php' );

	if ( ! fs.existsSync( sqlitePath ) && fs.existsSync( sqlitePhpPath ) ) {
		fs.renameSync( sqlitePhpPath, sqlitePath );
	}

	return sqlitePath;
}

/**
 * Creates wp-config.php symlinks in WP core directories that don't have one.
 *
 * Managed hosts often separate the WP core files (wp-load.php, wp-admin, etc.)
 * into a shared directory (e.g. __wp__/) while wp-config.php lives in the
 * document root.  WordPress resolves ABSPATH from wp-load.php's __DIR__ and
 * looks for wp-config.php there first.  When it's missing, WordPress redirects
 * to setup-config.php instead of loading the database.
 *
 * This reads the preflight state to find WP root directories that have
 * wp-load.php but not wp-config.php, then creates a relative symlink to the
 * nearest wp-config.php so WordPress can find its config regardless of which
 * directory ABSPATH resolves to.
 */
function ensureWpConfigSymlinksInCoreDirectories( runtimeBlueprintPath: string ): void {
	const importRoot = path.dirname( path.dirname( runtimeBlueprintPath ) );
	const rawDirectory = path.join( importRoot, 'raw' );
	const statePath = path.join( importRoot, 'state', '.import-state.json' );

	if ( ! fs.existsSync( statePath ) ) {
		return;
	}

	let roots: Array< Record< string, unknown > >;
	try {
		const state = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) as Record< string, unknown >;
		const preflight = ( state.preflight as Record< string, unknown > | undefined )?.data as
			| Record< string, unknown >
			| undefined;
		const wpDetect = preflight?.wp_detect as Record< string, unknown > | undefined;
		roots = Array.isArray( wpDetect?.roots ) ? wpDetect.roots : [];
	} catch {
		return;
	}

	// Find the root that has wp-config.php — that's the one we'll symlink to.
	let wpConfigRoot: string | null = null;
	for ( const root of roots ) {
		if ( root.wp_config !== true ) {
			continue;
		}
		const rootPath = decodeBase64Path( root.path );
		if ( rootPath ) {
			wpConfigRoot = rootPath;
			break;
		}
	}

	if ( ! wpConfigRoot ) {
		return;
	}

	// For each root that has wp-load but no wp-config, create a symlink.
	for ( const root of roots ) {
		if ( root.wp_config === true || root.wp_load !== true ) {
			continue;
		}

		const rootPath = decodeBase64Path( root.path );
		if ( ! rootPath ) {
			continue;
		}

		const hostCoreDir = path.join( rawDirectory, rootPath.replace( /^\//, '' ) );
		const wpConfigInCoreDir = path.join( hostCoreDir, 'wp-config.php' );

		if ( fs.existsSync( wpConfigInCoreDir ) ) {
			continue;
		}

		// Compute the relative path from the core directory to the wp-config root.
		const hostWpConfigDir = path.join( rawDirectory, wpConfigRoot.replace( /^\//, '' ) );
		const relativeWpConfig = path.relative(
			hostCoreDir,
			path.join( hostWpConfigDir, 'wp-config.php' )
		);

		try {
			fs.symlinkSync( relativeWpConfig, wpConfigInCoreDir );
		} catch {
			// Non-fatal — the site may still work if WordPress finds wp-config another way.
		}
	}
}

function decodeBase64Path( value: unknown ): string | null {
	if ( typeof value !== 'string' ) {
		return null;
	}
	if ( ! value.startsWith( 'base64:' ) ) {
		return value;
	}
	try {
		return Buffer.from( value.slice( 'base64:'.length ), 'base64' ).toString( 'utf8' );
	} catch {
		return null;
	}
}

export async function ensureImportedSiteSqliteReady(
	runtimeBlueprintPath: string
): Promise< string > {
	const wpContentPath = resolveImportedWpContentPath( runtimeBlueprintPath );
	const sqlitePath = normalizeImportedSqliteDatabasePath( runtimeBlueprintPath );
	await installSqliteIntegration( path.dirname( wpContentPath ) );
	ensureWpConfigSymlinksInCoreDirectories( runtimeBlueprintPath );
	return sqlitePath;
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
	const runtimeStartScriptPath = path.join( runtimeDirectory, 'start.sh' );
	const runtimePhpPath = path.join( runtimeDirectory, 'runtime.php' );

	let blueprint = loadRuntimeBlueprint( runtimeBlueprintPath );
	const startOptions: StartServerOptions = {
		blueprint,
		blueprintUri: runtimeBlueprintPath,
	};

	if ( ! fs.existsSync( runtimeStartScriptPath ) ) {
		if ( fs.existsSync( runtimePhpPath ) ) {
			blueprint = mergeBlueprintConstants(
				blueprint,
				await parseRuntimePhpConstants( fs.readFileSync( runtimePhpPath, 'utf-8' ) )
			);
			startOptions.blueprint = blueprint;
		}

		blueprint = mergeBlueprintConstants( blueprint, {
			DB_NAME: 'wordpress',
			DB_USER: 'wordpress',
			DB_PASSWORD: 'wordpress',
			DB_HOST: 'localhost',
		} );
		startOptions.blueprint = blueprint;
		startOptions.skipSqliteSetup = true;
		return startOptions;
	}

	const startScript = fs.readFileSync( runtimeStartScriptPath, 'utf-8' );

	// start.sh may contain paths that don't exist on the host:
	//
	// 1. VFS paths from older imports (/flat, /output, /state) that need
	//    mapping to their real host equivalents.
	//
	// 2. /internal/symlinks/ paths from PHP WASM's followSymlinks mode.
	//    When PHP WASM resolves a host symlink, it maps the target through
	//    /internal/symlinks/<absolute-host-path-without-leading-slash>.
	//    These paths work inside WASM but don't exist on the host.
	const importRoot = path.dirname( runtimeDirectory );
	const importMetadataPath = path.join( importRoot, 'import.json' );
	let sitePath: string | undefined;
	try {
		const meta = JSON.parse( fs.readFileSync( importMetadataPath, 'utf-8' ) );
		sitePath = meta.sitePath;
	} catch {
		// Fall through — mounts with unresolvable VFS paths will be filtered.
	}

	const vfsToHostMap: Record< string, string > = {
		'/flat': sitePath ?? '',
		'/output': runtimeDirectory,
		'/state': path.join( importRoot, 'state' ),
	};

	function resolveWasmMountPath( mount: { hostPath: string; vfsPath: string } ) {
		// Strip PHP WASM's internal symlink resolution prefix to recover
		// the real host path.
		const INTERNAL_SYMLINKS_PREFIX = '/internal/symlinks/';
		if ( mount.hostPath.startsWith( INTERNAL_SYMLINKS_PREFIX ) ) {
			return {
				hostPath: '/' + mount.hostPath.slice( INTERNAL_SYMLINKS_PREFIX.length ),
				vfsPath: mount.vfsPath,
			};
		}

		// Map legacy VFS paths to host paths.
		for ( const [ vfsPrefix, hostPrefix ] of Object.entries( vfsToHostMap ) ) {
			if ( mount.hostPath === vfsPrefix ) {
				return { hostPath: hostPrefix, vfsPath: mount.vfsPath };
			}
			if ( mount.hostPath.startsWith( vfsPrefix + '/' ) ) {
				return {
					hostPath: path.join( hostPrefix, mount.hostPath.slice( vfsPrefix.length + 1 ) ),
					vfsPath: mount.vfsPath,
				};
			}
		}

		return mount;
	}

	const mountsBeforeInstall = filterExistingMounts(
		getShellFlagValues( startScript, 'mount-before-install' )
			.map( parseMountSpec )
			.map( resolveWasmMountPath )
	);
	const mounts = filterExistingMounts(
		getShellFlagValues( startScript, 'mount' ).map( parseMountSpec ).map( resolveWasmMountPath )
	);
	const wordpressInstallMode = getShellFlagValues( startScript, 'wordpress-install-mode' ).at(
		0
	) as StartServerOptions[ 'wordpressInstallMode' ];

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
 * site path or the generated start.sh.
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
