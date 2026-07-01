import { mkdir } from 'node:fs/promises';
import path from 'node:path';
// Atomic (temp-file + rename) reads/writes so a crash mid-write can't corrupt
// app.json — important since it holds desktop UI state.
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAppConfigLockFilePath, getAppConfigPath } from '@studio/common/lib/well-known-paths';

/**
 * Shared accessor for `~/.studio/app.json` — the Desktop-owned config that the
 * `studio ui` server also reads/writes. Mirrors `shared-config` (for `shared.json`)
 * and the desktop's own user-data layer: atomic writes plus a single lockfile so
 * concurrent writers serialize instead of clobbering. Callers read-modify-write a
 * single field and leave the rest untouched, so this stays decoupled from the
 * full app.json schema (owned by the desktop's `UserData`).
 */
export type AppConfig = Record< string, unknown >;

export async function readAppConfig(): Promise< AppConfig > {
	try {
		return JSON.parse( await readFile( getAppConfigPath(), 'utf-8' ) ) as AppConfig;
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return {};
		}
		throw error;
	}
}

export async function saveAppConfig( config: AppConfig ): Promise< void > {
	// 2-space indent + trailing newline matches the desktop's `saveUserData`, so
	// the two writers don't produce noisy diffs against each other.
	await writeFile( getAppConfigPath(), JSON.stringify( config, null, 2 ) + '\n', 'utf-8' );
}

export async function lockAppConfig(): Promise< void > {
	const lockfilePath = getAppConfigLockFilePath();
	await mkdir( path.dirname( lockfilePath ), { recursive: true } );
	await lockFileAsync( lockfilePath, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

export async function unlockAppConfig(): Promise< void > {
	await unlockFileAsync( getAppConfigLockFilePath() );
}

/**
 * Run a single locked read-modify-write transaction: `mutate` receives the
 * current config (or `{}` if app.json doesn't exist yet), mutates it in place,
 * and its return value is forwarded back to the caller.
 */
export async function updateAppConfig< T >( mutate: ( config: AppConfig ) => T ): Promise< T > {
	try {
		await lockAppConfig();
		const config = await readAppConfig();
		const result = mutate( config );
		await saveAppConfig( config );
		return result;
	} finally {
		await unlockAppConfig();
	}
}
