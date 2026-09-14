import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BackupHandlerFactory } from '../backup-handler-factory';
import { BackupHandlerSql } from '../backup-handler-sql';
import { BackupHandlerTarGz } from '../backup-handler-tar-gz';
import { BackupHandlerXml } from '../backup-handler-xml';

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
} );
