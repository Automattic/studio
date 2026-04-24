import * as Sentry from '@sentry/electron/main';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	loadUserData as loadUserDataShared,
	saveUserData as saveUserDataShared,
	lockAppdata,
	unlockAppdata,
} from '@studio/common/lib/user-data';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getUserDataFilePath } from 'src/storage/paths';
import { EMPTY_USER_DATA, type UserData, type WindowBounds } from 'src/storage/storage-types';

export { lockAppdata, unlockAppdata };

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		return await loadUserDataShared< UserData >( {
			onInvalidJson: ( _err, fileContents ) => {
				Sentry.addBreadcrumb( {
					data: {
						fileContents: sanitizeUnstructuredData( fileContents ),
						filePath: sanitizeUserpath( filePath ),
					},
				} );
			},
		} );
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return EMPTY_USER_DATA;
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const persisted: UserData = { ...data };
	await saveUserDataShared( persisted );
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
	| 'betaFeatures'
	| 'colorScheme'
	| 'defaultSiteDirectory'
	| 'cliAutoInstalled';

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
