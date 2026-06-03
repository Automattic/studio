import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveScreenshotToTempFile } from '../tools/screenshot-helpers';

describe( 'screenshot helpers', () => {
	it( 'saves screenshots to a temporary local file', async () => {
		const buffer = Buffer.from( 'not-really-a-png' );
		const result = await saveScreenshotToTempFile( buffer, { viewportType: 'desktop' } );

		try {
			expect( result.path.startsWith( os.tmpdir() ) ).toBe( true );
			expect( result.fileUrl.startsWith( 'file://' ) ).toBe( true );
			expect( result.name ).toBe( 'screenshot-desktop.png' );
			expect( result.mimeType ).toBe( 'image/png' );
			await expect( readFile( result.path ) ).resolves.toEqual( buffer );
		} finally {
			await rm( path.dirname( result.path ), { recursive: true, force: true } );
		}
	} );
} );
