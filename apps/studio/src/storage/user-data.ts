import fs from 'fs';
import nodePath from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAppConfigLockFilePath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getUserDataFilePath } from 'src/storage/paths';
import {
	EMPTY_USER_DATA,
	type QuitSitesBehavior,
	type UserData,
	type WindowBounds,
} from 'src/storage/storage-types';

export type { QuitSitesBehavior };

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = JSON.parse( asString );
			const { siteMetadata, ...data } = parsed;
			return { ...data, version: 1, siteMetadata: siteMetadata ?? {} };
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
			return EMPTY_USER_DATA;
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const filePath = getUserDataFilePath();
	const persisted: UserData = { ...data };
	const asString = JSON.stringify( persisted, null, 2 ) + '\n';
	await writeFile( filePath, asString, 'utf-8' );
}

const LOCKFILE_PATH = getAppConfigLockFilePath();

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
	| 'quitSitesBehavior'
	| 'sentryUserId'
	| 'lastSeenVersion'
	| 'preferredTerminal'
	| 'preferredEditor'
	| 'betaFeatures'
	| 'colorScheme'
	| 'defaultSiteDirectory'
	| 'cliAutoInstalled'
	| 'cliUserUninstalled'
	| 'wapuuScore'
	| 'lastNightlyUpdateCheck'
	| 'nightlyPromptResult'
	| 'agenticUiBannerDismissed'
	| 'agenticFeaturesEnabled';

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
