import { app } from 'electron';
import fs from 'fs';
import nodePath from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { applyMigrations, type ConfigMigration } from '@studio/common/lib/config-migrator';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { sortSites } from '@studio/common/lib/sort-sites';
import { SupportedPHPVersion, SupportedPHPVersions } from '@studio/common/types/php-versions';
import { readFile, writeFile } from 'atomically';
import semver from 'semver';
import { sanitizeUnstructuredData, sanitizeUserpath } from 'src/lib/sanitize-for-logging';
import { getUserDataFilePath, getUserDataLockFilePath } from 'src/storage/paths';
import type { PersistedUserData, UserData, WindowBounds } from 'src/storage/storage-types';

// Before persisting the PHP version of sites, the default PHP version used was 8.0.
// In case we can't retrieve the PHP version from site details, we assume it was created
// with version 8.0.
const DEFAULT_PHP_VERSION_WHEN_UNKNOWN: SupportedPHPVersion = '8.0';

const migrateUserData = ( appName: string ) => {
	const appDataPath = app.getPath( 'appData' );
	const oldPath = nodePath.join( appDataPath, appName, 'appdata-v1.json' );
	const newPath = getUserDataFilePath();

	if ( fs.existsSync( oldPath ) && ! fs.existsSync( newPath ) ) {
		const dir = nodePath.dirname( newPath );
		if ( ! fs.existsSync( dir ) ) {
			fs.mkdirSync( dir, { recursive: true } );
		}
		fs.copyFileSync( oldPath, newPath );
		console.log(
			`Copied user data from ${ sanitizeUserpath( oldPath ) } to ${ sanitizeUserpath( newPath ) }`
		);
	}
};

// Temporary function to migrate old user data to the new location
// This function will be removed in a future release
function migrateUserDataOldName() {
	migrateUserData( 'Local Environment' );
	migrateUserData( 'Build' );
}

/**
 * Ensures each site has a valid PHP version. If the stored version is unsupported,
 * it selects the closest supported version (min if too low, max if too high).
 */
function populatePhpVersion( sites: SiteDetails[] ) {
	// Sort versions to reliably find min and max
	const sortedVersions = [ ...SupportedPHPVersions ].sort( ( a, b ) =>
		semver.compare( semver.coerce( a )!, semver.coerce( b )! )
	);
	const minVersion = sortedVersions[ 0 ];
	const maxVersion = sortedVersions[ sortedVersions.length - 1 ];
	const minCoerced = semver.coerce( minVersion )!;
	const maxCoerced = semver.coerce( maxVersion )!;

	sites.forEach( ( site ) => {
		if ( typeof site.phpVersion === 'undefined' ) {
			site.phpVersion = DEFAULT_PHP_VERSION_WHEN_UNKNOWN;
			return;
		}

		if ( SupportedPHPVersions.includes( site.phpVersion as SupportedPHPVersion ) ) {
			return;
		}

		const coercedPhpVersion = semver.coerce( site.phpVersion );
		if ( ! coercedPhpVersion ) {
			site.phpVersion = DEFAULT_PHP_VERSION_WHEN_UNKNOWN;
			return;
		}

		if ( semver.lt( coercedPhpVersion, minCoerced ) ) {
			site.phpVersion = minVersion;
		} else if ( semver.gt( coercedPhpVersion, maxCoerced ) ) {
			site.phpVersion = maxVersion;
		} else {
			site.phpVersion = DEFAULT_PHP_VERSION_WHEN_UNKNOWN;
		}
	} );
}

// Versioned data migrations for appdata.json.
// Add new migrations here with incrementing version numbers.
// Each migration receives the raw parsed JSON and returns transformed data.
export const appdataMigrations: ConfigMigration[] = [
	// Example for future use:
	// { version: 2, migrate: ( data ) => { /* transform */ return data; } },
];

export async function loadUserData(): Promise< UserData > {
	migrateUserDataOldName();
	const filePath = getUserDataFilePath();

	try {
		const asString = await readFile( filePath, 'utf-8' );
		try {
			const parsed = applyMigrations( JSON.parse( asString ), appdataMigrations );
			const data = fromDiskFormat( parsed as unknown as PersistedUserData );

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
	| 'onboardingCompleted'
	| 'locale'
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

function toDiskFormat( { sites, ...rest }: UserData ): PersistedUserData {
	return {
		version: 1,
		sites: sites.map(
			( {
				id,
				path,
				adminUsername,
				adminPassword,
				adminEmail,
				port,
				phpVersion,
				isWpAutoUpdating,
				name,
				themeDetails,
				customDomain,
				enableHttps,
				autoStart,
				latestCliPid,
				enableXdebug,
				enableDebugLog,
				enableDebugDisplay,
				sortOrder,
			} ) => {
				// No object spreading allowed. TypeScript's structural typing is too permissive and
				// will permit us to persist properties that aren't in the type definition.
				// Add each property explicitly instead.
				const persistedSiteDetails: PersistedUserData[ 'sites' ][ number ] = {
					id,
					name,
					path,
					adminUsername,
					adminPassword,
					adminEmail,
					port,
					phpVersion,
					isWpAutoUpdating,
					customDomain,
					enableHttps,
					autoStart,
					latestCliPid,
					enableXdebug,
					enableDebugLog,
					enableDebugDisplay,
					sortOrder,
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
