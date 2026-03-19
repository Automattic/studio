import fs from 'fs';
import nodePath from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { applyMigrations, type ConfigMigration } from '@studio/common/lib/config-migrator';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { readFile, writeFile } from 'atomically';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getUserDataFilePath, getUserDataLockFilePath } from 'src/storage/paths';
import type { PersistedUserData, UserData, WindowBounds } from 'src/storage/storage-types';

// Versioned data migrations for appdata.json.
// Add new migrations here with incrementing version numbers.
// Each migration receives the raw parsed JSON and returns transformed data.
export const appdataMigrations: ConfigMigration[] = [
	// Example for future use:
	// { version: 2, migrate: ( data ) => { /* transform */ return data; } },
];

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = applyMigrations( JSON.parse( asString ), appdataMigrations );
			const { version, sites, ...data } = parsed as unknown as PersistedUserData;
			return { sites: sites ?? {}, ...data };
		} catch ( err ) {
			if ( err instanceof SyntaxError ) {
				Sentry.addBreadcrumb( {
					data: {
						fileContents: sanitizeUnstructuredData( asString ),
						filePath: sanitizeUserpath( filePath ),
					},
				} );
			}
			throw err;
		}
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return { sites: {} };
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const filePath = getUserDataFilePath();
	const persisted: PersistedUserData = { version: 1, ...data };
	const asString = JSON.stringify( persisted, null, 2 ) + '\n';
	await writeFile( filePath, asString, 'utf-8' );
}

const LOCKFILE_PATH = getUserDataLockFilePath();

export async function lockAppdata() {
	const dir = nodePath.dirname( LOCKFILE_PATH );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}
	return lockFileAsync( LOCKFILE_PATH, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

export async function unlockAppdata() {
	return unlockFileAsync( LOCKFILE_PATH );
}

type UserDataSafeKeys =
	| 'devToolsOpen'
	| 'windowBounds'
	| 'onboardingCompleted'
	| 'promptWindowsSpeedUpResult'
	| 'stopSitesOnQuit'
	| 'sentryUserId'
	| 'lastSeenVersion'
	| 'preferredTerminal'
	| 'preferredEditor'
	| 'betaFeatures';

type PartialUserDataWithSafeKeysToUpdate = Partial< Pick< UserData, UserDataSafeKeys > >;

// Sometimes, we need to update the config file with a known value (i.e., not one that's derived
// from the current user config). This function should be used in those cases.
export async function updateAppdata(
	update: PartialUserDataWithSafeKeysToUpdate
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const updated = { ...userData, ...update };
		await saveUserData( updated );
	} finally {
		await unlockAppdata();
	}
}

export async function saveWindowBounds( bounds: WindowBounds ): Promise< void > {
	await updateAppdata( { windowBounds: bounds } );
}

export async function loadWindowBounds(): Promise< WindowBounds | undefined > {
	const userData = await loadUserData();
	return userData.windowBounds;
}
