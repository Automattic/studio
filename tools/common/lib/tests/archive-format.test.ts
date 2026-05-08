import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { isZipArchive } from '../archive-format';

const tempDirs: string[] = [];

function writeTempFile( name: string, data: Buffer ): string {
	const tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-archive-format-' ) );
	tempDirs.push( tempDir );
	const filePath = path.join( tempDir, name );
	fs.writeFileSync( filePath, data );
	return filePath;
}

describe( 'isZipArchive', () => {
	afterEach( () => {
		for ( const tempDir of tempDirs.splice( 0 ) ) {
			fs.rmSync( tempDir, { recursive: true, force: true } );
		}
	} );

	it( 'detects extensionless zip files', async () => {
		const filePath = writeTempFile(
			'update',
			Buffer.from( [ 0x50, 0x4b, 0x03, 0x04, 0x14, 0x00 ] )
		);

		await expect( isZipArchive( filePath ) ).resolves.toBe( true );
	} );

	it( 'rejects non-zip files', async () => {
		const filePath = writeTempFile(
			'archive.tar.gz',
			Buffer.from( [ 0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00 ] )
		);

		await expect( isZipArchive( filePath ) ).resolves.toBe( false );
	} );
} );
