import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	calculateDirectorySizeForArchive,
	confineToRoot,
	isPathWithin,
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
} );

describe( 'isPathWithin', () => {
	const root = path.join( os.tmpdir(), 'studio-sites' );

	it( 'accepts the root itself and its descendants', () => {
		expect( isPathWithin( root, root ) ).toBe( true );
		expect( isPathWithin( root, path.join( root, 'my-site' ) ) ).toBe( true );
		expect( isPathWithin( root, path.join( root, 'my-site', 'wp-content' ) ) ).toBe( true );
	} );

	it( 'rejects traversal escapes and unrelated paths', () => {
		expect( isPathWithin( root, path.join( root, '..', 'secret' ) ) ).toBe( false );
		expect( isPathWithin( root, path.join( root, '..', '..', 'etc', 'passwd' ) ) ).toBe( false );
		expect( isPathWithin( root, '/etc/passwd' ) ).toBe( false );
	} );

	it( 'rejects a sibling directory sharing the root as a name prefix', () => {
		expect( isPathWithin( root, `${ root }-other` ) ).toBe( false );
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
