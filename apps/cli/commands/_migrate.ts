/**
 * Hidden migration command for Studio
 *
 * Copies appdata-v1.json from the platform-specific Electron location
 * to ~/.studio/appdata.json. Called by Desktop on boot and as CLI middleware
 * for standalone installations.
 */

import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { getAppdataDirectory } from 'cli/lib/appdata';
import { STUDIO_CLI_HOME } from 'cli/lib/paths';

export function getNewAppdataPath(): string {
	return path.join( STUDIO_CLI_HOME, 'appdata.json' );
}

function getOldAppdataPath(): string {
	return path.join( getAppdataDirectory(), 'appdata-v1.json' );
}

export async function migrateAppdata(): Promise< void > {
	const newPath = getNewAppdataPath();

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

export async function commandHandler() {
	try {
		await migrateAppdata();
	} catch ( error ) {
		console.error( 'Migration failed:', error );
		process.exitCode = 1;
	}
}
