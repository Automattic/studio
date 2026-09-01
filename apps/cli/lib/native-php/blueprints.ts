import fs from 'node:fs';
import path from 'node:path';
import {
	createBlueprintTempDir,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { getBlueprintsPharPath, getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { PhpCommandError, runPhpCommand } from './php-process';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

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
	phpVersion: NativePhpSupportedVersion,
	signal: AbortSignal
): Promise< void > {
	// blueprints.phar accepts local paths only; remote URIs need the Playground runtime.
	if ( blueprint.uri.startsWith( 'http://' ) || blueprint.uri.startsWith( 'https://' ) ) {
		throw new Error(
			`Remote blueprint URIs are not supported by the native PHP runtime: ${ blueprint.uri }`
		);
	}

	const enableDebugLog = config.enableDebugLog ?? false;
	const enableDebugDisplay = config.enableDebugDisplay ?? false;
	const defaultConstants: Record< string, boolean | string > = {
		// The SQLite driver requires a non-empty DB_NAME at runtime.
		DB_NAME: 'wordpress',
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
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
				// blueprints.phar runs `wp-cli` steps by shelling out to `php` on the
				// PATH. Expose the bundled binary so blueprints work on machines
				// without a system PHP install (e.g. CI and most users).
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
