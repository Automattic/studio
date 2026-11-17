import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, it, expect } from 'vitest';
import { writeZip } from 'cli/tests/zip-fixture';
import { setupServerFiles } from '../setup';

const root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-server-files-' ) );
const latest = path.join( root, 'versions', 'latest' );
const zipPath = path.join( root, 'wordpress.zip' );

vi.mock( '../paths', () => ( {
	readBundledManifest: () => ( { wordpressVersion: '7.1.3', phpMyAdminHash: 'unused' } ),
	getBundledWordPressZipPath: () => zipPath,
	getWordPressVersionPath: ( version: string ) => path.join( root, 'versions', version ),
} ) );

const count = ( dir: string ) => fs.readdirSync( dir, { recursive: true } ).length;

// The app runs several CLI commands at once, and each installs the bundled WordPress. Any reader
// that finds version.php copies `latest` into a new site, so it must never see a partial copy.
it( 'never shows a partial latest WordPress while several processes install it', async () => {
	const files: Record< string, string > = {
		'wordpress/wp-includes/version.php': "<?php $wp_version = '7.1.3';",
	};
	for ( let i = 0; i < 50; i++ ) {
		files[ `wordpress/wp-includes/file-${ i }.php` ] = '<?php';
	}
	await writeZip( zipPath, files );
	// An interrupted earlier install, without version.php.
	fs.mkdirSync( path.join( latest, 'wp-includes' ), { recursive: true } );
	fs.writeFileSync( path.join( latest, 'wp-includes', 'stray.php' ), '<?php' );
	const expectedCount = Object.keys( files ).length + 1; // The files and `wp-includes/`.

	let installing = true;
	let partialSightings = 0;
	const watch = ( async () => {
		while ( installing ) {
			const hasVersion = fs.existsSync( path.join( latest, 'wp-includes', 'version.php' ) );
			if ( hasVersion && count( latest ) !== expectedCount ) {
				partialSightings++;
			}
			await new Promise( ( resolve ) => setImmediate( resolve ) );
		}
	} )();
	await Promise.all( Array.from( { length: 2 }, () => setupServerFiles() ) );
	installing = false;
	await watch;

	expect( partialSightings ).toBe( 0 );
	expect( count( latest ) ).toBe( expectedCount );
	expect( fs.readdirSync( path.dirname( latest ) ) ).toEqual( [ 'latest' ] );
	fs.rmSync( root, { recursive: true, force: true } );
} );
