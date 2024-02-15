import fs from 'fs';
import nodePath from 'path';
import { isErrnoException } from '../lib/is-errno-exception';
import { sortSites } from '../lib/sort-sites';
import { getUserDataFilePath } from './paths';
import type { PersistedUserData, UserData } from './storage-types';

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		const asString = await fs.promises.readFile( filePath, 'utf-8' );
		const parsed = JSON.parse( asString );
		const data = fromDiskFormat( parsed );
		sortSites( data.sites );
		console.log( `Loaded user data from ${ filePath }` );
		return data;
	} catch ( err: unknown ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return {
				sites: [],
				snapshots: [],
			};
		}
		console.error( `Failed to load file ${ filePath }: ${ err }` );
		throw err;
	}
}

export async function saveUserData( data: UserData ): Promise< void > {
	const filePath = getUserDataFilePath();

	const asString = JSON.stringify( toDiskFormat( data ), null, 2 ) + '\n';
	await fs.promises.writeFile( filePath, asString, 'utf-8' );
	console.log( `Saved user data to ${ filePath }` );
}

function toDiskFormat( { sites, ...rest }: UserData ): PersistedUserData {
	return {
		version: 1,
		sites: sites.map( ( { id, path, port, name } ) => {
			// No object spreading allowed. TypeScript's structural typing is too permissive and
			// will permit us to persist properties that aren't in the type definition.
			// Add each property explicitly instead.
			const persistedSiteDetails: PersistedUserData[ 'sites' ][ number ] = {
				id,
				name,
				path,
				port,
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
