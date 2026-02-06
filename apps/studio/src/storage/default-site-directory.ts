import fs from 'fs';
import fsPromises from 'fs/promises';
import { DEFAULT_SITE_PATH } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';

async function ensurePathIsDirectory( directory: string ) {
	const stats = await fsPromises.stat( directory );
	if ( ! stats.isDirectory() ) {
		throw new Error( 'Selected path is not a directory.' );
	}
}

async function ensurePathIsWritable( directory: string ) {
	await fsPromises.access( directory, fs.constants.W_OK );
}

export async function ensureWritableDirectory( directory: string ) {
	await ensurePathIsDirectory( directory );
	await ensurePathIsWritable( directory );
}

export async function getStoredDefaultSiteDirectory(): Promise< string | undefined > {
	const userData = await loadUserData();
	return userData.defaultSiteDirectory;
}

export async function resolveDefaultSiteDirectory(): Promise< string > {
	const storedPath = await getStoredDefaultSiteDirectory();
	if ( storedPath ) {
		try {
			await ensureWritableDirectory( storedPath );
			return storedPath;
		} catch ( error ) {
			console.warn(
				'Stored default site directory is unavailable, falling back to built-in path.',
				error
			);
		}
	}

	return DEFAULT_SITE_PATH;
}
