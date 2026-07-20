import { describe, it, expect } from 'vitest';
import { BackupHandlerFactory } from '../backup-handler-factory';
import { BackupHandlerSql } from '../backup-handler-sql';
import { BackupHandlerXml } from '../backup-handler-xml';

describe( 'BackupHandlerFactory', () => {
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
} );
