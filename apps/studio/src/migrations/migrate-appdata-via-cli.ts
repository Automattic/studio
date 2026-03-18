/**
 * Migrates appdata-v1.json from the platform-specific Electron location
 * to ~/.studio/appdata.json on Desktop boot.
 */

import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { getUserDataFilePath } from 'src/storage/paths';

/**
 * Returns the old platform-specific appdata path used by previous Studio versions.
 * macOS: ~/Library/Application Support/Studio/appdata-v1.json
 * Windows: %APPDATA%\Studio\appdata-v1.json
 */
function getOldAppdataPath(): string {
	if ( process.platform === 'win32' ) {
		return path.join( process.env.APPDATA || '', 'Studio', 'appdata-v1.json' );
	}
	const os = require( 'os' );
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'appdata-v1.json' );
}

export async function migrateAppdata(): Promise< void > {
	const newPath = getUserDataFilePath();

	if ( fs.existsSync( newPath ) ) {
		return;
	}

	const oldPath = getOldAppdataPath();

	if ( ! fs.existsSync( oldPath ) ) {
		return;
	}

	const dir = path.dirname( newPath );
	if ( ! fs.existsSync( dir ) ) {
		fs.mkdirSync( dir, { recursive: true } );
	}

	const content = await readFile( oldPath, { encoding: 'utf8' } );
	await writeFile( newPath, content, { encoding: 'utf8' } );

	console.log( `Migrated appdata from ${ oldPath } to ${ newPath }` );
}
