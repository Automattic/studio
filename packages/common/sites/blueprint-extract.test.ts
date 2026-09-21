import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { extractBlueprintUpload } from './blueprint-extract';
import type { ExtractedBlueprintBundle } from './blueprint-extract';

const extractedBundle: ExtractedBlueprintBundle = {
	blueprintJson: {},
	blueprintJsonPath: '/tmp/extracted/blueprint.json',
	tempDir: '/tmp/extracted',
};

describe( 'extractBlueprintUpload', () => {
	it( 'writes the upload to a fixed filename and removes it', async () => {
		let uploadedPath = '';
		const extract = vi.fn( async ( filePath: string ) => {
			uploadedPath = filePath;
			expect( path.basename( filePath ) ).toBe( 'blueprint.zip' );
			expect( await fs.readFile( filePath, 'utf8' ) ).toBe( 'zip contents' );
			return extractedBundle;
		} );

		await expect(
			extractBlueprintUpload( Readable.from( 'zip contents' ), extract )
		).resolves.toBe( extractedBundle );
		await expect( fs.access( path.dirname( uploadedPath ) ) ).rejects.toThrow();
	} );

	it( 'removes the uploaded file when extraction fails', async () => {
		let uploadedPath = '';
		const extract = vi.fn( async ( filePath: string ) => {
			uploadedPath = filePath;
			throw new Error( 'Invalid ZIP' );
		} );

		await expect( extractBlueprintUpload( Readable.from( 'invalid' ), extract ) ).rejects.toThrow(
			'Invalid ZIP'
		);
		await expect( fs.access( path.dirname( uploadedPath ) ) ).rejects.toThrow();
	} );
} );
