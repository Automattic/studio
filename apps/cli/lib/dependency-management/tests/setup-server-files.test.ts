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

	// The app starts several CLI commands at once, and each runs this setup. A reader that finds
	// version.php in latest copies it into a new site straight away.
	it( 'never shows a partial latest while several processes install at once', async () => {
		const expected = listFiles( bundled ).length;
		let done = false;
		let partialSightings = 0;
		const watch = ( async () => {
			while ( ! done ) {
				if (
					fs.existsSync( path.join( latest, 'wp-includes', 'version.php' ) ) &&
					listFiles( latest ).length !== expected
				) {
					partialSightings++;
				}
				await new Promise( ( resolve ) => setImmediate( resolve ) );
			}
		} )();

		await Promise.all( Array.from( { length: 8 }, () => setupServerFiles() ) );
		done = true;
		await watch;

		expect( partialSightings ).toBe( 0 );
		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect( fs.readdirSync( versions ) ).toEqual( [ 'latest' ] );
		expect( console.error ).not.toHaveBeenCalled();
	} );

	it.each( [
		{
			existing: 'an incomplete latest left by an interrupted copy',
			seed: () => {
				fs.mkdirSync( path.join( latest, 'wp-includes' ), { recursive: true } );
				fs.writeFileSync( path.join( latest, 'wp-includes', 'partial.php' ), 'partial' );
			},
			kept: [ 'latest' ],
		},
		{
			existing: 'an older latest',
			seed: () => writeWordPress( latest, '7.0.0' ),
			kept: [ '7.0.0', 'latest' ],
		},
	] )( 'replaces $existing with the bundled WordPress', async ( { seed, kept } ) => {
		seed();

		await setupServerFiles();

		expect( listFiles( latest ) ).toEqual( listFiles( bundled ) );
		expect( fs.readdirSync( versions ).sort() ).toEqual( kept );
	} );
} );
