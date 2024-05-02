import { app } from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { isErrnoException } from '../lib/is-errno-exception';
import { sanitizeUnstructuredData, sanitizeUserpath } from '../lib/sanitize-for-logging';
import { sortSites } from '../lib/sort-sites';
import { getUserDataFilePath } from './paths';
import type { PersistedUserData, UserData } from './storage-types';

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

export async function loadUserData(): Promise< UserData > {
	migrateUserDataOldName();
	const filePath = getUserDataFilePath();

	try {
		const asString = await fs.promises.readFile( filePath, 'utf-8' );
		try {
			const parsed = JSON.parse( asString );
			const data = fromDiskFormat( parsed );
			sortSites( data.sites );
			console.log( `Loaded user data from ${ sanitizeUserpath( filePath ) }` );
			return data;
		} catch ( err ) {
			// Awkward double try-catch needed to have access to the file contents
			if ( err instanceof SyntaxError ) {
				Sentry.addBreadcrumb( {
					data: {
						fileContents: sanitizeUnstructuredData( asString ),
						filePath,
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
	await fs.promises.writeFile( filePath, asString, 'utf-8' );
	console.log( `Saved user data to ${ sanitizeUserpath( filePath ) }` );
}

function toDiskFormat( { sites, ...rest }: UserData ): PersistedUserData {
	return {
		version: 1,
		sites: sites.map( ( { id, path, adminPassword, port, name, themeDetails } ) => {
			// No object spreading allowed. TypeScript's structural typing is too permissive and
			// will permit us to persist properties that aren't in the type definition.
			// Add each property explicitly instead.
			const persistedSiteDetails: PersistedUserData[ 'sites' ][ number ] = {
				id,
				name,
				path,
				adminPassword,
				port,
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
		} ),
		...rest,
	};
}

function fromDiskFormat( { version, sites, ...rest }: PersistedUserData ): UserData {
	return {
		sites: sites
			.filter( ( site ) => fs.existsSync( site.path ) ) // Remove sites the user has deleted from disk
			.map( ( { path, name, ...restOfSite } ) => ( {
				name: name || nodePath.basename( path ),
				path,
				running: false,
				...restOfSite,
			} ) ),
		...rest,
	};
}
