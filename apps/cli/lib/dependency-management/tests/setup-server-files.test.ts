import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupServerFiles } from '../setup';

const dirs = vi.hoisted( () => ( { wpFiles: '', serverFiles: '' } ) );

vi.mock( '../paths', () => ( {
	getWpFilesPath: () => dirs.wpFiles,
	getWordPressVersionPath: ( version: string ) =>
		path.join( dirs.serverFiles, 'wordpress-versions', version ),
} ) );

const FILE_COUNT = 400;

function writeWordPress( root: string, version: string ) {
	fs.mkdirSync( path.join( root, 'wp-includes' ), { recursive: true } );
	fs.writeFileSync(
		path.join( root, 'wp-includes', 'version.php' ),
		`<?php\n$wp_version = '${ version }';\n`
	);
	for ( let i = 0; i < FILE_COUNT; i++ ) {
		const dir = path.join( root, 'wp-includes', `dir-${ i % 20 }` );
		fs.mkdirSync( dir, { recursive: true } );
		fs.writeFileSync( path.join( dir, `file-${ i }.php` ), `<?php // ${ version } ${ i }\n` );
	}
}

function listFiles( root: string ): string[] {
	return fs
		.readdirSync( root, { recursive: true, withFileTypes: true } )
		.filter( ( entry ) => entry.isFile() )
		.map( ( entry ) => path.relative( root, path.join( entry.parentPath, entry.name ) ) )
		.sort();
}

describe( 'setupServerFiles', () => {
	let root: string;
	let bundled: string;
	let versions: string;
	let latest: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-server-files-' ) );
		dirs.wpFiles = path.join( root, 'wp-files' );
		dirs.serverFiles = path.join( root, 'server-files' );
		bundled = path.join( dirs.wpFiles, 'latest', 'wordpress' );
		versions = path.join( dirs.serverFiles, 'wordpress-versions' );
		latest = path.join( versions, 'latest' );
		writeWordPress( bundled, '7.1.3' );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'installs the bundled WordPress as latest and leaves no staging directory', async () => {
		await setupServerFiles();

		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect( fs.readdirSync( versions ) ).toEqual( [ 'latest' ] );
	} );

	// The app starts several CLI commands at once, and each runs this setup.
	it( 'leaves one complete copy when several processes install at once', async () => {
		await Promise.all( Array.from( { length: 8 }, () => setupServerFiles() ) );

		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect( fs.readdirSync( versions ) ).toEqual( [ 'latest' ] );
		expect( console.error ).not.toHaveBeenCalled();
	} );

	// A reader that finds version.php copies latest into a new site straight away.
	it( 'never shows latest with version.php before every file is there', async () => {
		const expected = listFiles( bundled ).length;
		let done = false;
		let incompleteSightings = 0;
		const watch = ( async () => {
			while ( ! done ) {
				if ( fs.existsSync( path.join( latest, 'wp-includes', 'version.php' ) ) ) {
					if ( listFiles( latest ).length !== expected ) {
						incompleteSightings++;
					}
				}
				await new Promise( ( resolve ) => setImmediate( resolve ) );
			}
		} )();

		await setupServerFiles();
		done = true;
		await watch;

		expect( incompleteSightings ).toBe( 0 );
		expect( listFiles( latest ) ).toHaveLength( expected );
	} );

	it( 'replaces an incomplete latest left by an interrupted copy', async () => {
		fs.mkdirSync( path.join( latest, 'wp-includes', 'dir-0' ), { recursive: true } );
		fs.writeFileSync( path.join( latest, 'wp-includes', 'dir-0', 'file-0.php' ), 'partial' );

		await setupServerFiles();

		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect( fs.readdirSync( versions ) ).toEqual( [ 'latest' ] );
	} );

	it( 'keeps an older latest under its version when the bundled WordPress is newer', async () => {
		writeWordPress( latest, '7.0.0' );

		await setupServerFiles();

		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect(
			fs.readFileSync( path.join( latest, 'wp-includes', 'version.php' ), 'utf8' )
		).toContain( '7.1.3' );
		expect( fs.readdirSync( versions ).sort() ).toEqual( [ '7.0.0', 'latest' ] );
	} );
} );
