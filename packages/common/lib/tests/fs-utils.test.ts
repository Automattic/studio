import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { calculateDirectorySizeForArchive } from '@studio/common/lib/fs-utils';

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
