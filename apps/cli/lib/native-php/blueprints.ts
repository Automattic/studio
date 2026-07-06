import fs from 'node:fs';
import path from 'node:path';
import {
	createBlueprintTempDir,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { getDatabaseProviderForSite } from 'cli/lib/database/providers';
import { getBlueprintsPharPath, getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { runPhpCommand } from './php-process';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

function isWriteAccessError( error: unknown ): boolean {
	const code = ( error as NodeJS.ErrnoException )?.code;
	return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
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
	const databaseProvider = getDatabaseProviderForSite( config );
	const defaultConstants: Record< string, boolean | string > = {
		...databaseProvider.getWpConfigConstants( config ),
		WP_DEBUG: enableDebugLog || enableDebugDisplay,
		WP_DEBUG_LOG: enableDebugLog,
		WP_DEBUG_DISPLAY: enableDebugDisplay,
	};

	blueprint.contents.constants = {
		...blueprint.contents.constants,
		...defaultConstants,
	};
	// Native PHP selects PHP and installs WordPress before Blueprint execution.
	// Passing preferredVersions makes blueprints.phar validate versions it does not manage here.
	delete blueprint.contents.preferredVersions;

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
	const needsSymlink =
		databaseProvider.usesSqliteIntegration &&
		fs.existsSync( muPluginsSqlite ) &&
		! fs.existsSync( pluginsSqlite );
	let symlinkIno: number | undefined;
	if ( needsSymlink ) {
		fs.symlinkSync( muPluginsSqlite, pluginsSqlite, 'junction' );
		// Remove only the entry created here, not unrelated content that replaced it.
		symlinkIno = fs.statSync( pluginsSqlite ).ino;
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
				...databaseProvider.getBlueprintDatabaseArgs( config ),
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
	} finally {
		await fs.promises.unlink( tmpPath ).catch( () => {} );
		if ( fallbackTempDir ) {
			await removeBlueprintTempDir( fallbackTempDir ).catch( () => {} );
		}
		if ( needsSymlink ) {
			try {
				if ( fs.statSync( pluginsSqlite ).ino === symlinkIno ) {
					await fs.promises.rm( pluginsSqlite, { recursive: true, force: true } );
				}
			} catch {
				// Best effort - leaving the symlink behind is non-fatal.
			}
		}
	}
}
