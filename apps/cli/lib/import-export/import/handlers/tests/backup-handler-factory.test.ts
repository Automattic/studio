import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BackupHandlerFactory } from '../backup-handler-factory';
import { BackupHandlerSql } from '../backup-handler-sql';
import { BackupHandlerTarGz } from '../backup-handler-tar-gz';
import { BackupHandlerWpress } from '../backup-handler-wpress';
import { BackupHandlerXml } from '../backup-handler-xml';
import { BackupHandlerZip } from '../backup-handler-zip';

describe( 'BackupHandlerFactory', () => {
	let temporaryDirectory: string;
	const writeFixture = ( name: string, contents: Buffer ) => {
		const filePath = path.join( temporaryDirectory, name );
		fs.writeFileSync( filePath, contents );
		return filePath;
	};

	beforeAll( () => {
		temporaryDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio_factory_test' ) );
	} );

	afterAll( () => {
		fs.rmSync( temporaryDirectory, { recursive: true, force: true } );
	} );

	it( 'creates a BackupHandlerXml for an .xml file with an xml mime type', () => {
		const handler = BackupHandlerFactory.create( {
			path: '/tmp/export.xml',
			type: 'application/xml',
		} );
		expect( handler ).toBeInstanceOf( BackupHandlerXml );
	} );

	it( 'creates a BackupHandlerXml for an .xml file with an empty mime type', () => {
		const handler = BackupHandlerFactory.create( { path: '/tmp/export.xml', type: '' } );
		expect( handler ).toBeInstanceOf( BackupHandlerXml );
	} );

	it( 'does not create a BackupHandlerXml for a .sql file', () => {
		const handler = BackupHandlerFactory.create( { path: '/tmp/backup.sql', type: '' } );
		expect( handler ).toBeInstanceOf( BackupHandlerSql );
	} );

	it( 'returns undefined for an unsupported file', () => {
		expect(
			BackupHandlerFactory.create( { path: '/tmp/notes.txt', type: 'text/plain' } )
		).toBeUndefined();
	} );

	it( 'creates a BackupHandlerTarGz for a plain .tar file', () => {
		const filePath = writeFixture( 'backup.tar', Buffer.alloc( 512 ) );
		const handler = BackupHandlerFactory.create( { path: filePath, type: 'application/x-tar' } );
		expect( handler ).toBeInstanceOf( BackupHandlerTarGz );
	} );

	it( 'creates a BackupHandlerTarGz for a .tgz file', () => {
		const filePath = writeFixture( 'backup.tgz', Buffer.from( [ 0x1f, 0x8b, 0x08, 0x00 ] ) );
		const handler = BackupHandlerFactory.create( { path: filePath, type: 'application/gzip' } );
		expect( handler ).toBeInstanceOf( BackupHandlerTarGz );
	} );

	it( 'creates a BackupHandlerTarGz for a gzipped archive with a misleading extension', () => {
		const filePath = writeFixture( 'backup.tar', Buffer.from( [ 0x1f, 0x8b, 0x08, 0x00 ] ) );
		const handler = BackupHandlerFactory.create( { path: filePath, type: '' } );
		expect( handler ).toBeInstanceOf( BackupHandlerTarGz );
	} );

	it( 'does not treat a .zip file as a tar archive', () => {
		const filePath = writeFixture( 'backup.zip', Buffer.from( [ 0x50, 0x4b, 0x03, 0x04 ] ) );
		const handler = BackupHandlerFactory.create( { path: filePath, type: 'application/zip' } );
		expect( handler ).not.toBeInstanceOf( BackupHandlerTarGz );
	} );

	describe( 'uppercase extensions', () => {
		it( 'creates a BackupHandlerZip for a .ZIP file', () => {
			const filePath = writeFixture( 'BACKUP.ZIP', Buffer.from( [ 0x50, 0x4b, 0x03, 0x04 ] ) );
			expect(
				BackupHandlerFactory.create( { path: filePath, type: 'application/zip' } )
			).toBeInstanceOf( BackupHandlerZip );
		} );

		it( 'creates a BackupHandlerTarGz for a .TAR file', () => {
			const filePath = writeFixture( 'BACKUP.TAR', Buffer.alloc( 512 ) );
			expect(
				BackupHandlerFactory.create( { path: filePath, type: 'application/x-tar' } )
			).toBeInstanceOf( BackupHandlerTarGz );
		} );

		it( 'creates a BackupHandlerSql for a .SQL file', () => {
			const filePath = writeFixture( 'DUMP.SQL', Buffer.from( 'SELECT 1;' ) );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerSql
			);
		} );

		it( 'creates a BackupHandlerXml for an .XML file', () => {
			const filePath = writeFixture( 'EXPORT.XML', Buffer.from( '<rss />' ) );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerXml
			);
		} );

		it( 'creates a BackupHandlerWpress for a .WPRESS file', () => {
			const filePath = writeFixture( 'BACKUP.WPRESS', Buffer.alloc( 16 ) );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerWpress
			);
		} );
	} );

	describe( 'gzipped files that are not tar archives', () => {
		const gzipped = zlib.gzipSync( Buffer.from( 'payload' ) );

		it( 'routes a gzipped .sql file to the sql handler', () => {
			const filePath = writeFixture( 'dump.sql', gzipped );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerSql
			);
		} );

		it( 'routes a gzipped .xml file to the xml handler', () => {
			const filePath = writeFixture( 'export.xml', gzipped );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerXml
			);
		} );

		it( 'routes a gzipped .wpress file to the wpress handler', () => {
			const filePath = writeFixture( 'backup.wpress', gzipped );
			expect( BackupHandlerFactory.create( { path: filePath, type: '' } ) ).toBeInstanceOf(
				BackupHandlerWpress
			);
		} );
	} );
} );
