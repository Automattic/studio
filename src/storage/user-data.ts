import fs from 'fs';
import nodePath from 'path';
import { getUserDataFilePath } from './paths';
import type { PersistedUserData, UserData } from './storage-types';

export async function loadUserData(): Promise< UserData > {
	const filePath = getUserDataFilePath();

	try {
		const asString = await fs.promises.readFile( filePath, 'utf-8' );
		const parsed = JSON.parse( asString );
		const data = fromDiskFormat( parsed );
		console.log( `loaded user data from ${ filePath }: ${ JSON.stringify( data, null, 2 ) }` );
		return data;
	} catch ( err: any ) {
		if ( err && 'code' in err && err.code === 'ENOENT' ) {
			return {
				sites: [],
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
	console.log( `saved user data to ${ filePath }: ${ asString }` );
}

function toDiskFormat( { sites, ...rest }: UserData ): PersistedUserData {
	return {
		version: 1,
		sites: sites.map( ( { name: _name, running: _running, ...restOfSite } ) => ( {
			...restOfSite,
		} ) ),
		...rest,
	};
}

function fromDiskFormat( { version: _, sites, ...rest }: PersistedUserData ): UserData {
	return {
		sites: sites
			.filter( ( site ) => fs.existsSync( site.path ) ) // Remove sites the user has deleted from disk
			.map( ( { path, ...restOfSite } ) => ( {
				name: nodePath.basename( path ),
				path,
				running: false,
				...restOfSite,
			} ) ),
		...rest,
	};
}
