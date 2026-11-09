import fs from 'fs';
import { pipeline } from 'node:stream/promises';
import os from 'os';
import path from 'path';
import { ZipArchive, TarArchive } from 'archiver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateExportArchive } from '../validate-archive';

describe( 'validateExportArchive', () => {
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-validate-export-' ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	async function createArchive( extension: string, zip64 = false ) {
		const filePath = path.join( root, `backup.${ extension }` );
		const archive =
			extension === 'zip'
				? new ZipArchive( { store: true, forceZip64: zip64 } )
				: new TarArchive( { gzip: true } );
		const written = pipeline( archive, fs.createWriteStream( filePath ) );
		archive.append( 'Site content to verify', { name: 'wp-content/example.txt' } );
		await Promise.all( [ archive.finalize(), written ] );
		return filePath;
	}

	it.each( [ 'zip', 'tar.gz', 'tgz' ] )( 'accepts a complete %s archive', async ( extension ) => {
		await expect(
			validateExportArchive( await createArchive( extension ) )
		).resolves.toBeUndefined();
	} );

	it( 'accepts a ZIP64 central directory', async () => {
		await expect(
			validateExportArchive( await createArchive( 'zip', true ) )
		).resolves.toBeUndefined();
	} );

	it( 'rejects a ZIP missing its end-of-central-directory record', async () => {
		const archive = await createArchive( 'zip' );
		fs.truncateSync( archive, fs.statSync( archive ).size - 22 );

		await expect( validateExportArchive( archive ) ).rejects.toThrow(
			'Failed to validate exported archive'
		);
	} );

	it( 'rejects corrupted file data even when the ZIP directory and file size are intact', async () => {
		const archive = await createArchive( 'zip' );
		const bytes = fs.readFileSync( archive );
		const position = bytes.indexOf( 'Site content to verify' );
		expect( position ).toBeGreaterThan( 0 );
		bytes[ position ] ^= 1;
		fs.writeFileSync( archive, bytes );

		await expect( validateExportArchive( archive ) ).rejects.toThrow(
			'Invalid checksum for wp-content/example.txt'
		);
	} );

	it( 'rejects an incomplete gzip stream', async () => {
		const archive = await createArchive( 'tar.gz' );
		fs.truncateSync( archive, fs.statSync( archive ).size - 8 );

		await expect( validateExportArchive( archive ) ).rejects.toThrow(
			'Failed to validate exported archive'
		);
	} );

	it( 'checks a large entry without loading the whole archive or entry into memory', async () => {
		const source = path.join( root, 'large.bin' );
		const fd = fs.openSync( source, 'w' );
		fs.ftruncateSync( fd, 32 * 1024 * 1024 );
		fs.closeSync( fd );
		const filePath = path.join( root, 'large.zip' );
		const archive = new ZipArchive( { zlib: { level: 1 } } );
		const written = pipeline( archive, fs.createWriteStream( filePath ) );
		archive.file( source, { name: 'large.bin' } );
		await Promise.all( [ archive.finalize(), written ] );
		const readFile = vi.spyOn( fs, 'readFile' );
		const readFileSync = vi.spyOn( fs, 'readFileSync' );

		await expect( validateExportArchive( filePath ) ).resolves.toBeUndefined();
		expect( readFile ).not.toHaveBeenCalled();
		expect( readFileSync ).not.toHaveBeenCalled();
	} );
} );
