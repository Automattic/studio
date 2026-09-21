import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { CLI_CONFIG_LOCKFILE_NAME, LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { hideDirectoryOnWindows } from './hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { getCliConfigPath, getConfigDirectory } from './well-known-paths';

/**
 * File primitives for the CLI-owned `~/.studio/cli.json`: path, directory
 * bootstrap, lockfile, and raw (schema-less) read/write. The CLI layers its
 * typed schema on top (`apps/cli/lib/cli-config/core.ts`); other processes
 * (local server, desktop) read and patch individual fields through
 * `packages/common/ai/settings-store.ts`. Keep serialization and locking here
 * so every writer agrees on them.
 */

export const CLI_CONFIG_VERSION = 1;

export async function ensureCliConfigDirectory(): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}
}

export async function lockCliConfigFile(): Promise< void > {
	// The config directory may not exist yet on a first run; `lockfile.lock`
	// would reject with ENOENT instead of waiting.
	await ensureCliConfigDirectory();
	await lockFileAsync( path.join( getConfigDirectory(), CLI_CONFIG_LOCKFILE_NAME ), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

export async function unlockCliConfigFile(): Promise< void > {
	await unlockFileAsync( path.join( getConfigDirectory(), CLI_CONFIG_LOCKFILE_NAME ) );
}

/**
 * Reads cli.json as an untyped object, returning the empty default when the
 * file does not exist. Throws on unreadable or non-object content; schema
 * validation is the caller's concern.
 */
export async function readCliConfigFileRaw(): Promise< Record< string, unknown > > {
	const configPath = getCliConfigPath();
	if ( ! fs.existsSync( configPath ) ) {
		return { version: CLI_CONFIG_VERSION, sites: [], snapshots: [] };
	}
	const parsed: unknown = JSON.parse( await readFile( configPath, { encoding: 'utf8' } ) );
	if ( typeof parsed !== 'object' || parsed === null ) {
		throw new Error( 'Invalid CLI config file format.' );
	}
	return parsed as Record< string, unknown >;
}

export async function writeCliConfigFileRaw( config: Record< string, unknown > ): Promise< void > {
	await ensureCliConfigDirectory();
	await writeFile( getCliConfigPath(), JSON.stringify( config, null, 2 ) + '\n', {
		encoding: 'utf8',
	} );
}
