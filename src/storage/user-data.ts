import { app } from 'electron';
import fs from 'fs';
import nodePath from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { SupportedPHPVersion, SupportedPHPVersions } from 'common/types/php-versions';
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from 'common/constants';
import { isErrnoException } from 'common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from 'common/lib/lockfile';
import { sortSites } from 'common/lib/sort-sites';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getUserDataFilePath, getUserDataLockFilePath } from 'src/storage/paths';
import type { PersistedUserData, UserData, WindowBounds } from 'src/storage/storage-types';

// Before persisting the PHP version of sites, the default PHP version used was 8.0.
// In case we can't retrieve the PHP version from site details, we assume it was created
// with version 8.0.
export const DEFAULT_PHP_VERSION_WHEN_UNKNOWN: SupportedPHPVersion = '8.0';

const migrateUserData = ( appName: string ) => {
	const appDataPath = app.getPath( 'appData' );
	const oldPath = nodePath.join( appDataPath, appName, 'appdata-v1.json' );
	const newPath = getUserDataFilePath();

	if ( fs.existsSync( oldPath ) && ! fs.existsSync( newPath ) ) {
		fs.renameSync( oldPath, newPath );
		console.log(
			`Moved user data from ${ sanitizeUserpath( oldPath ) } to ${ sanitizeUserpath( newPath ) }`
		);
	}
};

// Temporary function to migrate old user data to the new location
// This function will be removed in a future release
function migrateUserDataOldName() {
	migrateUserData( 'Local Environment' );
	migrateUserData( 'Build' );
}

function populatePhpVersion( sites: SiteDetails[] ) {
	sites.forEach( ( site ) => {
		if (
			typeof site.phpVersion === 'undefined' ||
			! SupportedPHPVersions.includes( site.phpVersion as SupportedPHPVersion )
		) {
			site.phpVersion = DEFAULT_PHP_VERSION_WHEN_UNKNOWN;
		}
	} );
}

function legacyPopulateSnapshotUserIds( data: UserData ): void {
	const userId = data.authToken?.id;

	if ( userId && data.snapshots ) {
		data.snapshots = data.snapshots.map( ( snapshot ) => {
			if ( ! snapshot.userId ) {
				return { ...snapshot, userId };
			}
			return snapshot;
		} );
	}
}

export async function loadUserData(): Promise< UserData > {
	migrateUserDataOldName();
	const filePath = getUserDataFilePath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = JSON.parse( asString );
			const data = fromDiskFormat( parsed );

			// Temporarily populate old snapshots with userId of authenticated user.
			// See PR #937 for more context.
			legacyPopulateSnapshotUserIds( data );
			sortSites( data.sites );
			populatePhpVersion( data.sites );
			return data;
		} catch ( err ) {
			// Awkward double try-catch needed to have access to the file contents
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
			return {
				sites: [],
				snapshots: [],
			};
		}
		console.error( `Failed to load file ${ sanitizeUserpath( filePath ) }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const filePath = getUserDataFilePath();
	const asString = JSON.stringify( toDiskFormat( data ), null, 2 ) + '\n';
	await writeFile( filePath, asString, 'utf-8' );
}

const LOCKFILE_PATH = getUserDataLockFilePath();

export async function lockAppdata() {
	return lockFileAsync( LOCKFILE_PATH, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
}

export async function unlockAppdata() {
	return unlockFileAsync( LOCKFILE_PATH );
}

type UserDataSafeKeys =
	| 'devToolsOpen'
	| 'windowBounds'
	| 'authToken'
	| 'snapshots'
	| 'onboardingCompleted'
	| 'locale'
	| 'promptWindowsSpeedUpResult'
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

function toDiskFormat( { sites, ...rest }: UserData ): PersistedUserData {
	return {
		version: 1,
		sites: sites.map(
			( {
				id,
				path,
				adminPassword,
				port,
				phpVersion,
				isWpAutoUpdating,
				name,
				themeDetails,
				customDomain,
				enableHttps,
				autoStart,
				latestCliPid,
			} ) => {
				// No object spreading allowed. TypeScript's structural typing is too permissive and
				// will permit us to persist properties that aren't in the type definition.
				// Add each property explicitly instead.
				const persistedSiteDetails: PersistedUserData[ 'sites' ][ number ] = {
					id,
					name,
					path,
					adminPassword,
					port,
					phpVersion,
					isWpAutoUpdating,
					customDomain,
					enableHttps,
					autoStart,
					latestCliPid,
					themeDetails: {
						name: themeDetails?.name || '',
						path: themeDetails?.path || '',
						slug: themeDetails?.slug || '',
						isBlockTheme: themeDetails?.isBlockTheme || false,
						supportsWidgets: themeDetails?.supportsWidgets || false,
						supportsMenus: themeDetails?.supportsMenus || false,
					},
				};

				return persistedSiteDetails;
			}
		),
		...rest,
	};
}

function fromDiskFormat( { version, sites, ...rest }: PersistedUserData ): UserData {
	return {
		sites: sites
			.filter( ( site ) => fs.existsSync( site.path ) ) // Remove sites the user has deleted from disk
			.map( ( { path, name, autoStart, ...restOfSite } ) => ( {
				name: name || nodePath.basename( path ),
				path,
				running: false,
				autoStart: autoStart || false,
				...restOfSite,
			} ) ),
		...rest,
	};
}

export async function saveWindowBounds( bounds: WindowBounds ): Promise< void > {
	await updateAppdata( { windowBounds: bounds } );
}

export async function loadWindowBounds(): Promise< WindowBounds | undefined > {
	const userData = await loadUserData();
	return userData.windowBounds;
}
