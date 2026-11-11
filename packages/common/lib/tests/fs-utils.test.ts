import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	calculateDirectorySizeForArchive,
	confineToRoot,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';

describe( 'calculateDirectorySizeForArchive', () => {
	let tempDir: string;

	beforeEach( () => {
		tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'fs-utils-test-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
	} );

	it( 'sums the sizes of the directory contents', async () => {
		fs.writeFileSync( path.join( tempDir, 'a.php' ), '12345' );
		fs.mkdirSync( path.join( tempDir, 'nested' ) );
		fs.writeFileSync( path.join( tempDir, 'nested', 'b.php' ), '123' );

		await expect( calculateDirectorySizeForArchive( tempDir ) ).resolves.toBe( 8 );
	} );

	it( 'skips a dangling symlink instead of failing the size calculation', async () => {
		fs.writeFileSync( path.join( tempDir, 'a.php' ), '12345' );
		// A broken symlink whose target was never created — mirrors the WP Cloud
		// `advanced-cache.php` drop-in that a reprint pull leaves dangling.
		fs.symlinkSync(
			path.join( tempDir, 'wordpress/drop-ins/advanced-cache.php' ),
			path.join( tempDir, 'advanced-cache.php' )
		);
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		await expect( calculateDirectorySizeForArchive( tempDir ) ).resolves.toBe( 5 );
		expect( warnSpy ).toHaveBeenCalledWith( expect.stringContaining( 'advanced-cache.php' ) );

		warnSpy.mockRestore();
	} );

	it( 'counts the contents of a symlinked directory', async () => {
		fs.mkdirSync( path.join( tempDir, 'site' ) );
		fs.mkdirSync( path.join( tempDir, 'target' ) );
		fs.writeFileSync( path.join( tempDir, 'target', 'plugin.php' ), '1234567' );
		fs.symlinkSync(
			path.join( tempDir, 'target' ),
			path.join( tempDir, 'site', 'linked' ),
			'junction'
		);

		await expect( calculateDirectorySizeForArchive( path.join( tempDir, 'site' ) ) ).resolves.toBe(
			7
		);
	} );

	it( 'stops at a symlink back to a parent directory', async () => {
		fs.mkdirSync( path.join( tempDir, 'nested' ) );
		fs.writeFileSync( path.join( tempDir, 'nested', 'a.php' ), '12345' );
		fs.symlinkSync( tempDir, path.join( tempDir, 'nested', 'loop' ), 'junction' );

		await expect( calculateDirectorySizeForArchive( tempDir ) ).resolves.toBe( 5 );
	} );
} );

describe( 'confineToRoot', () => {
	const root = path.join( os.tmpdir(), 'studio-sites' );

	it( 'returns the resolved path for the root itself and its descendants', () => {
		expect( confineToRoot( root, root ) ).toBe( path.resolve( root ) );
		expect( confineToRoot( root, path.join( root, 'my-site' ) ) ).toBe(
			path.resolve( root, 'my-site' )
		);
	} );

	it( 'normalizes traversal segments that stay inside the root', () => {
		expect( confineToRoot( root, path.join( root, 'a', '..', 'b' ) ) ).toBe(
			path.resolve( root, 'b' )
		);
	} );

	it( 'returns null for traversal escapes and unrelated paths', () => {
		expect( confineToRoot( root, path.join( root, '..', 'secret' ) ) ).toBeNull();
		expect( confineToRoot( root, '/etc/passwd' ) ).toBeNull();
		expect( confineToRoot( root, `${ root }-other` ) ).toBeNull();
	} );

	it( 'resolves relative candidates against the root, not the cwd', () => {
		expect( confineToRoot( root, 'my-site' ) ).toBe( path.resolve( root, 'my-site' ) );
	} );
} );

// Symlinks aren't created without extra privileges on Windows.
describe.skipIf( process.platform === 'win32' )( 'recursiveCopyDirectory', () => {
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'fs-utils-copy-' ) );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'copies what symlinks point to, and skips a link back to a copied directory', async () => {
		const outside = path.join( root, 'outside' );
		fs.mkdirSync( path.join( outside, 'plugins' ), { recursive: true } );
		fs.writeFileSync( path.join( outside, 'plugins', 'plugin.php' ), 'plugin' );
		fs.writeFileSync( path.join( outside, 'note.txt' ), 'note' );
		const source = path.join( root, 'site' );
		fs.mkdirSync( source );
		fs.symlinkSync( outside, path.join( source, 'wp-content' ) );
		fs.symlinkSync( path.join( outside, 'note.txt' ), path.join( source, 'note.txt' ) );
		fs.symlinkSync( source, path.join( source, 'loop' ) );
		const destination = path.join( root, 'copy' );

		await recursiveCopyDirectory( source, destination );

		const copiedContent = path.join( destination, 'wp-content' );
		expect( fs.lstatSync( copiedContent ).isDirectory() ).toBe( true );
		expect( fs.readFileSync( path.join( copiedContent, 'plugins', 'plugin.php' ), 'utf8' ) ).toBe(
			'plugin'
		);
		expect( fs.lstatSync( path.join( destination, 'note.txt' ) ).isFile() ).toBe( true );
		expect( fs.existsSync( path.join( destination, 'loop' ) ) ).toBe( false );
	} );
} );
