import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, it, expect } from 'vitest';
import { setupServerFiles } from '../setup';

const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-server-files-' ) );
const latest = path.join( root, 'versions', 'latest' );

vi.mock( '../paths', () => ( {
	getWpFilesPath: () => path.join( root, 'wp-files' ),
	getWordPressVersionPath: ( version: string ) => path.join( root, 'versions', version ),
} ) );

const count = ( dir: string ) => fs.readdirSync( dir, { recursive: true } ).length;

// The app runs several CLI commands at once, and each installs the bundled WordPress. Any reader
// that finds version.php copies `latest` into a new site, so it must never see a partial copy.
// Eight concurrent copies of 400 files can take longer than the default 5 s on Windows CI.
it( 'never shows a partial latest WordPress while several processes install it', async () => {
	const bundled = path.join( root, 'wp-files', 'latest', 'wordpress', 'wp-includes' );
	fs.mkdirSync( bundled, { recursive: true } );
	fs.writeFileSync( path.join( bundled, 'version.php' ), "<?php $wp_version = '7.1.3';" );
	for ( let i = 0; i < 50; i++ ) {
		fs.writeFileSync( path.join( bundled, `file-${ i }.php` ), '<?php' );
	}
	// An interrupted earlier copy, without version.php.
	fs.mkdirSync( path.join( latest, 'wp-includes' ), { recursive: true } );
	fs.writeFileSync( path.join( latest, 'wp-includes', 'stray.php' ), '<?php' );

	let installing = true;
	let partialSightings = 0;
	const watch = ( async () => {
		while ( installing ) {
			const hasVersion = fs.existsSync( path.join( latest, 'wp-includes', 'version.php' ) );
			if ( hasVersion && count( latest ) !== count( path.dirname( bundled ) ) ) {
				partialSightings++;
			}
			await new Promise( ( resolve ) => setImmediate( resolve ) );
		}
	} )();
	await Promise.all( Array.from( { length: 2 }, () => setupServerFiles() ) );
	installing = false;
	await watch;

	expect( partialSightings ).toBe( 0 );
	expect( count( latest ) ).toBe( count( path.dirname( bundled ) ) );
	expect( fs.readdirSync( path.dirname( latest ) ) ).toEqual( [ 'latest' ] );
	fs.rmSync( root, { recursive: true, force: true } );
}, 30_000 );
