import fs from 'node:fs';
import path from 'node:path';
import {
	createBlueprintTempDir,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { getWpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import {
	getBlueprintsPharPath,
	getPhpBinaryPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { getFullyResolvedTmpDirPath } from 'cli/lib/native-php/tmp-dir';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { getWpCliPhpIniArgs } from 'cli/lib/wp-cli-php-ini';
import { PhpCommandError, runPhpCommand } from './php-process';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

// blueprints.phar caps each download at 30 s in total, so large plugins (e.g. Gutenberg) fail
// on slow connections. Remove once the bundled phar includes WordPress/php-toolkit#322.
export const BLUEPRINT_HTTP_TIMEOUT_MS = 10 * 60 * 1000;

// Hooks the runner's filters through the `$wp_filter` global its polyfilled `apply_filters()`
// reads, since the phar exposes no CLI options for these.
// - `blueprint.http_client`: a phar with `idle_timeout_ms` already fails only stalled downloads,
//   so its client is kept.
// - `blueprint.resolved`: the runner otherwise executes its downloaded wp-cli.phar directly,
//   relying on the `#!/usr/bin/env php` shebang, which Windows ignores, so `wp-cli` steps silently
//   do nothing there. `wpCliPath` is set here because the v1 to v2 transpiler drops it.
export function getBlueprintRunnerPrependContent( wpCliCommand: string ): string {
	return `<?php
$GLOBALS['wp_filter']['blueprint.http_client'][10][] = array(
	'function'      => function ( $client ) {
		if ( property_exists( '\\WordPress\\HttpClient\\ClientState', 'idle_timeout_ms' ) ) {
			return $client;
		}
		return new \\WordPress\\HttpClient\\Client( array( 'timeout_ms' => ${ BLUEPRINT_HTTP_TIMEOUT_MS } ) );
	},
	'accepted_args' => 1,
);
$GLOBALS['wp_filter']['blueprint.resolved'][10][] = array(
	'function'      => function ( $blueprint ) {
		if ( empty( $blueprint['additionalStepsAfterExecution'] ) || ! is_array( $blueprint['additionalStepsAfterExecution'] ) ) {
			return $blueprint;
		}
		foreach ( $blueprint['additionalStepsAfterExecution'] as $index => $step ) {
			if ( is_array( $step ) && isset( $step['step'] ) && 'wp-cli' === $step['step'] ) {
				$blueprint['additionalStepsAfterExecution'][ $index ]['wpCliPath'] = ${ toPhpSingleQuotedString(
					wpCliCommand
				) };
			}
		}
		return $blueprint;
	},
	'accepted_args' => 1,
);
`;
}

function writeBlueprintRunnerPrependFile( wpCliCommand: string ): string {
	const dir = fs.mkdtempSync(
		path.join( getFullyResolvedTmpDirPath(), 'studio-blueprint-prepend-' )
	);
	const prependPath = path.join( dir, 'prepend.php' );
	fs.writeFileSync( prependPath, getBlueprintRunnerPrependContent( wpCliCommand ) );
	return prependPath;
}

function isWriteAccessError( error: unknown ): boolean {
	const code = ( error as NodeJS.ErrnoException )?.code;
	return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

// blueprints.phar fails the whole Blueprint on an unknown feature rather than ignoring it.
const RUNNER_SUPPORTED_FEATURES = [ 'networking' ];

// Studio picks the PHP binary, installs WordPress, and ships Intl, so these are already decided.
export function normalizeBlueprintForRunner( contents: Record< string, unknown > ): void {
	delete contents.preferredVersions;

	const features = contents.features;
	if ( ! features || typeof features !== 'object' ) {
		return;
	}

	const supported = Object.fromEntries(
		Object.entries( features ).filter( ( [ name ] ) => RUNNER_SUPPORTED_FEATURES.includes( name ) )
	);
	if ( Object.keys( supported ).length > 0 ) {
		contents.features = supported;
	} else {
		delete contents.features;
	}
}

// The runner joins a step's `wpCliPath` and its arguments into one string run through the shell
// (`cmd` on Windows, `sh` elsewhere), so each part is quoted for that shell.
function quoteForShell( arg: string, platform: NodeJS.Platform ): string {
	return platform === 'win32' ? `"${ arg }"` : `'${ arg.replace( /'/g, `'\\''` ) }'`;
}

export function getWpCliCommandForRunner(
	phpBinaryPath: string,
	wpCliPharPath: string,
	platform: NodeJS.Platform = process.platform
): string {
	return [ phpBinaryPath, ...getWpCliPhpIniArgs(), wpCliPharPath ]
		.map( ( arg ) => quoteForShell( arg, platform ) )
		.join( ' ' );
}

function toPhpSingleQuotedString( value: string ): string {
	return `'${ value.replace( /[\\']/g, ( char ) => `\\${ char }` ) }'`;
}

export async function removeOwnedSqliteSymlink(
	symlinkPath: string,
	symlinkIno: number
): Promise< void > {
	try {
		if ( fs.lstatSync( symlinkPath ).ino === symlinkIno ) {
			await fs.promises.rm( symlinkPath, { recursive: true, force: true } );
		}
	} catch {
		// Best effort - an already-removed symlink needs no cleanup.
	}
}

// Fits a schema validation report (one line per offending property) without overflowing a toast.
const MAX_BLUEPRINT_ERROR_LENGTH = 2000;

function truncate( message: string ): string {
	return message.length > MAX_BLUEPRINT_ERROR_LENGTH
		? `${ message.slice( 0, MAX_BLUEPRINT_ERROR_LENGTH ) }…`
		: message;
}

/**
 * The runner reports on stdout as JSON lines, progress interleaved with errors. Only `message` is
 * kept; the `details.trace` on step failures is a phar-internal stack, meaningless to the user.
 */
export function formatBlueprintRunnerError( error: PhpCommandError ): string {
	const reportedErrors: string[] = [];
	for ( const line of error.stdout.split( /\r?\n/ ) ) {
		const trimmed = line.trim();
		if ( ! trimmed.startsWith( '{' ) ) {
			continue;
		}
		try {
			const parsed = JSON.parse( trimmed );
			if ( parsed?.type === 'error' && typeof parsed.message === 'string' ) {
				reportedErrors.push( parsed.message );
			}
		} catch {
			// A partial line from a truncated capture - nothing to report from it.
		}
	}

	if ( reportedErrors.length > 0 ) {
		return truncate( reportedErrors.join( '\n' ) );
	}

	const stderr = error.stderr.trim();
	return stderr ? truncate( stderr ) : error.message;
}

export async function runBlueprint(
	config: ServerConfig,
	blueprint: NonNullable< ServerConfig[ 'blueprint' ] >,
	phpVersion: SupportedPHPVersion,
	signal: AbortSignal
): Promise< void > {
	// blueprints.phar accepts local paths only.
	if ( blueprint.uri.startsWith( 'http://' ) || blueprint.uri.startsWith( 'https://' ) ) {
		throw new Error( `Remote blueprint URIs are not supported: ${ blueprint.uri }` );
	}

	const enableDebugLog = config.enableDebugLog ?? false;
	const enableDebugDisplay = config.enableDebugDisplay ?? false;
	const defaultConstants: Record< string, boolean | string > = {
		// The SQLite driver requires a non-empty DB_NAME at runtime.
		DB_NAME: 'wordpress',
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
		// SCRIPT_DEBUG is independent of WP_DEBUG in WordPress, so it must not
		// feed the WP_DEBUG expression above.
		SCRIPT_DEBUG: config.enableScriptDebug ?? false,
		WP_ENVIRONMENT_TYPE: getWpEnvironmentType( config ),
	};

	blueprint.contents.constants = {
		...blueprint.contents.constants,
		...defaultConstants,
	};
	normalizeBlueprintForRunner( blueprint.contents );

	// Co-locate the modified blueprint with the original so blueprints.phar can
	// resolve sibling resources; fall back to a temp dir if that dir is read-only.
	const serializedBlueprint = JSON.stringify( blueprint.contents );
	const blueprintFilename = `studio-blueprint-${ config.siteId }.json`;
	let fallbackTempDir: string | undefined;
	let tmpPath = path.join( path.dirname( blueprint.uri ), blueprintFilename );
	try {
		await fs.promises.writeFile( tmpPath, serializedBlueprint );
	} catch ( error ) {
		if ( ! isWriteAccessError( error ) ) {
			throw error;
		}
		fallbackTempDir = await createBlueprintTempDir();
		tmpPath = path.join( fallbackTempDir, blueprintFilename );
		try {
			await fs.promises.writeFile( tmpPath, serializedBlueprint );
		} catch ( fallbackError ) {
			// The finally below only runs once the run-blueprint try starts, so clean
			// up the just-created temp dir here to avoid leaking it under os.tmpdir().
			await removeBlueprintTempDir( fallbackTempDir ).catch( () => {} );
			throw fallbackError;
		}
	}

	// blueprints.phar detects SQLite under plugins, while Studio installs it under mu-plugins.
	const muPluginsSqlite = path.join(
		config.sitePath,
		'wp-content',
		'mu-plugins',
		'sqlite-database-integration'
	);
	const pluginsSqlite = path.join(
		config.sitePath,
		'wp-content',
		'plugins',
		'sqlite-database-integration'
	);
	const needsSymlink = fs.existsSync( muPluginsSqlite ) && ! fs.existsSync( pluginsSqlite );
	let symlinkIno: number | undefined;
	if ( needsSymlink ) {
		fs.symlinkSync( muPluginsSqlite, pluginsSqlite, 'junction' );
		// Remove only the entry created here, not unrelated content that replaced it.
		symlinkIno = fs.lstatSync( pluginsSqlite ).ino;
	}

	const prependPath = writeBlueprintRunnerPrependFile(
		getWpCliCommandForRunner( getPhpBinaryPath( phpVersion ), getWpCliPharPath() )
	);

	try {
		await runPhpCommand(
			[
				getBlueprintsPharPath(),
				'exec',
				tmpPath,
				'--mode=apply-to-existing-site',
				`--site-path=${ config.sitePath }`,
				`--site-url=${ config.absoluteUrl ?? `http://localhost:${ config.port }` }`,
				'--db-engine=sqlite',
				`--db-path=${ path.join( config.sitePath, 'wp-content', 'database', '.ht.sqlite' ) }`,
			],
			{
				phpVersion,
				signal,
				autoPrependFile: prependPath,
				// Expose the bundled binary to anything the runner or WP-CLI starts through
				// `php` on the PATH, for machines without a system PHP install.
				env: {
					PATH: `${ path.dirname( getPhpBinaryPath( phpVersion ) ) }${ path.delimiter }${
						process.env.PATH ?? ''
					}`,
				},
			}
		);
	} catch ( error ) {
		if ( error instanceof PhpCommandError ) {
			throw new Error( formatBlueprintRunnerError( error ) );
		}
		throw error;
	} finally {
		await fs.promises.unlink( tmpPath ).catch( () => {} );
		await fs.promises
			.rm( path.dirname( prependPath ), { recursive: true, force: true } )
			.catch( () => {} );
		if ( fallbackTempDir ) {
			await removeBlueprintTempDir( fallbackTempDir ).catch( () => {} );
		}
		if ( needsSymlink ) {
			await removeOwnedSqliteSymlink( pluginsSqlite, symlinkIno! );
			// The runner may remove the symlink target while managing its SQLite driver.
			await keepSqliteIntegrationUpdated( config.sitePath );
		}
	}
}
