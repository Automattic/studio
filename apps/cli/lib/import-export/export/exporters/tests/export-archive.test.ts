import fs from 'fs';
import { Readable } from 'node:stream';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { ExportEvents } from '@studio/common/lib/import-export-events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yauzl from 'yauzl';
import { runWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { DefaultExporter } from '../default-exporter';
import type { ExportOptions } from '../../types';

vi.mock( 'cli/lib/run-wp-cli-command', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/run-wp-cli-command') >() ),
	runWpCliCommand: vi.fn(),
} ) );

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

async function readZipEntries( filePath: string ): Promise< yauzl.Entry[] > {
	const zip = await openZip( filePath, { lazyEntries: true } );
	try {
		return await new Promise( ( resolve, reject ) => {
			const entries: yauzl.Entry[] = [];
			zip.on( 'entry', ( entry: yauzl.Entry ) => {
				entries.push( entry );
				zip.readEntry();
			} );
			zip.on( 'error', reject );
			zip.on( 'end', () => resolve( entries ) );
			zip.readEntry();
		} );
	} finally {
		zip.close();
	}
}

describe( 'export archive completion', () => {
	let root: string;
	let backupFile: string;
	let exporter: DefaultExporter;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-export-completion-' ) );
		fs.mkdirSync( path.join( root, 'wp-content' ) );
		fs.writeFileSync( path.join( root, 'wp-content', 'example.txt' ), 'Site content' );
		fs.writeFileSync( path.join( root, 'wp-config.php' ), "<?php\n$table_prefix = 'wp_';\n" );
		backupFile = path.join( root, 'backup.zip' );
		exporter = new DefaultExporter( {
			site: { id: 'site-1', name: 'Export fixture', path: root, port: 8881 },
			backupFile,
			includes: { wpContent: true, database: false },
			phpVersion: '8.3',
		} as ExportOptions );
		vi.mocked( runWpCliCommand ).mockImplementation( async () => ( {
			response: new WpCliResponse(
				Readable.from( [ '[]' ] ),
				Readable.from( [] ),
				Promise.resolve( 0 )
			),
			[ Symbol.dispose ]: () => {},
		} ) );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'rejects a destination that closes before all bytes have been written', async () => {
		const complete = vi.fn();
		exporter.on( ExportEvents.EXPORT_COMPLETE, complete );
		const createWriteStream = fs.createWriteStream;
		vi.spyOn( fs, 'createWriteStream' ).mockImplementation( ( ...args ) => {
			const output = createWriteStream( ...args );
			output._write = ( _chunk, _encoding, callback ) => {
				output.destroy();
				callback();
			};
			return output;
		} );

		await expect( exporter.export() ).rejects.toThrow();
		expect( complete ).not.toHaveBeenCalled();
		expect( fs.existsSync( backupFile ) ).toBe( false );
	} );

	it( 'preserves an existing destination when it cannot be opened for writing', async () => {
		fs.writeFileSync( backupFile, 'previous backup must survive' );
		const createWriteStream = fs.createWriteStream;
		vi.spyOn( fs, 'createWriteStream' ).mockImplementation( ( file ) =>
			createWriteStream( file, {
				fs: {
					open: ( _path, _flags, _mode, callback ) =>
						queueMicrotask( () =>
							callback( Object.assign( new Error( 'Permission denied' ), { code: 'EACCES' } ), 0 )
						),
					write: fs.write,
					writev: fs.writev,
					close: fs.close,
				},
			} )
		);
		await expect( exporter.export() ).rejects.toThrow();
		expect( fs.readFileSync( backupFile, 'utf8' ) ).toBe( 'previous backup must survive' );
	} );

	it( 'reports a failed write and removes the partial destination', async () => {
		const complete = vi.fn();
		const failed = vi.fn();
		exporter.on( ExportEvents.EXPORT_COMPLETE, complete );
		exporter.on( ExportEvents.EXPORT_ERROR, failed );
		const createWriteStream = fs.createWriteStream;
		vi.spyOn( fs, 'createWriteStream' ).mockImplementation( ( ...args ) => {
			const output = createWriteStream( ...args );
			output._write = ( _chunk, _encoding, callback ) => {
				callback( Object.assign( new Error( 'No space left on device' ), { code: 'ENOSPC' } ) );
			};
			return output;
		} );

		await expect( exporter.export() ).rejects.toThrow( 'No space left on device' );
		expect( complete ).not.toHaveBeenCalled();
		expect( failed ).toHaveBeenCalledWith(
			expect.objectContaining( {
				code: 'export_failed',
				message: expect.stringContaining( 'No space left on device' ),
			} )
		);
		expect( fs.existsSync( backupFile ) ).toBe( false );
	} );

	it( 'keeps the previous backup when validation of the new archive fails', async () => {
		fs.writeFileSync( backupFile, 'previous backup must survive' );
		const originalFiles = fs.readdirSync( root );
		const complete = vi.fn();
		const created = vi.fn();
		exporter.on( ExportEvents.EXPORT_COMPLETE, complete );
		exporter.on( ExportEvents.BACKUP_CREATE_COMPLETE, created );
		const createWriteStream = fs.createWriteStream;
		vi.spyOn( fs, 'createWriteStream' ).mockImplementation( ( ...args ) => {
			const output = createWriteStream( ...args );
			output.once( 'close', () => fs.truncateSync( output.path, 1 ) );
			return output;
		} );

		await expect( exporter.export() ).rejects.toThrow( 'Failed to validate exported archive' );
		expect( complete ).not.toHaveBeenCalled();
		expect( created ).not.toHaveBeenCalled();
		expect( fs.readFileSync( backupFile, 'utf8' ) ).toBe( 'previous backup must survive' );
		expect( fs.readdirSync( root ) ).toEqual( originalFiles );
	} );

	it.each( [ 'zip', 'tar.gz' ] )(
		'replaces the old backup with a usable %s archive',
		async ( extension ) => {
			const complete = vi.fn();
			backupFile = path.join( root, `backup.${ extension }` );
			fs.writeFileSync( backupFile, 'previous backup' );
			exporter = new DefaultExporter( {
				site: { id: 'site-1', name: 'Export fixture', path: root, port: 8881 },
				backupFile,
				includes: { wpContent: true, database: false },
				phpVersion: '8.3',
			} as ExportOptions );
			exporter.on( ExportEvents.EXPORT_COMPLETE, complete );

			await expect( exporter.export() ).resolves.toBeUndefined();
			expect( complete ).toHaveBeenCalledOnce();
			expect( fs.statSync( backupFile ).size ).toBeGreaterThan( 0 );
		}
	);

	it( 'excludes the old and staged archives when the destination is inside wp-content', async () => {
		const backupDirectory = path.join( root, 'wp-content', 'uploads' );
		fs.mkdirSync( backupDirectory );
		backupFile = path.join( backupDirectory, 'backup.zip' );
		fs.writeFileSync( backupFile, 'previous backup' );
		fs.writeFileSync( path.join( backupDirectory, 'photo.txt' ), 'Keep this file' );
		exporter = new DefaultExporter( {
			site: { id: 'site-1', name: 'Export fixture', path: root, port: 8881 },
			backupFile,
			includes: { wpContent: true, database: false },
			phpVersion: '8.3',
		} as ExportOptions );

		await exporter.export();

		const entries = ( await readZipEntries( backupFile ) ).map( ( entry ) => entry.fileName );
		expect( entries.filter( ( name ) => name.startsWith( 'wp-content/uploads/' ) ) ).toEqual( [
			'wp-content/uploads/photo.txt',
		] );
		expect( fs.readdirSync( backupDirectory ) ).toEqual( [ 'backup.zip', 'photo.txt' ] );
	} );

	it( 'removes the partial archive when collecting site metadata fails', async () => {
		vi.mocked( runWpCliCommand ).mockRejectedValueOnce( new Error( 'Metadata export failed' ) );

		await expect( exporter.export() ).rejects.toThrow( 'Metadata export failed' );
		expect( fs.existsSync( backupFile ) ).toBe( false );
	} );

	it.skipIf( ! process.env.STUDIO_EXPORT_LARGE_FILE_RESULT )(
		'exports and validates an entry larger than 4 GiB with bounded memory',
		async () => {
			const bytes = 2 ** 32 + 17;
			const source = path.join( root, 'wp-content', 'large.bin' );
			const fd = fs.openSync( source, 'w' );
			fs.ftruncateSync( fd, bytes );
			fs.writeSync( fd, Buffer.from( 'first' ), 0, 5, 0 );
			fs.writeSync( fd, Buffer.from( 'last' ), 0, 4, bytes - 4 );
			fs.closeSync( fd );
			const started = performance.now();

			await exporter.export();

			const entries = await readZipEntries( backupFile );
			expect(
				entries.find( ( entry ) => entry.fileName === 'wp-content/large.bin' )?.uncompressedSize
			).toBe( bytes );
			const maxRssMiB = Math.round( process.resourceUsage().maxRSS / 1024 );
			expect( maxRssMiB ).toBeLessThan( 1024 );
			fs.writeFileSync(
				process.env.STUDIO_EXPORT_LARGE_FILE_RESULT!,
				JSON.stringify( {
					sourceBytes: bytes,
					archiveBytes: fs.statSync( backupFile ).size,
					elapsedMs: Math.round( performance.now() - started ),
					maxRssMiB,
				} )
			);
		},
		180000
	);
} );
