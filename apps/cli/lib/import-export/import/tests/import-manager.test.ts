import { describe, it, expect, vi } from 'vitest';
import { LoggerError } from 'cli/logger';
import { ImportExportEventEmitter } from '../../events';
import { BackupHandlerFactory } from '../handlers/backup-handler-factory';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from '../import-manager';
import { WxrImporter } from '../importers/wxr-importer';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '../handlers/backup-handler-factory', () => ( {
	BackupHandlerFactory: { create: vi.fn() },
} ) );

// Mirrors the private `selectImporter` logic: the first validator whose
// `canHandle` returns true wins.
function selectImporterClass( fileList: string[] ) {
	for ( const { validator, importer } of DEFAULT_IMPORTER_OPTIONS ) {
		if ( validator.canHandle( fileList ) ) {
			return importer;
		}
	}
	return null;
}

describe( 'DEFAULT_IMPORTER_OPTIONS', () => {
	it( 'selects the WxrImporter for a lone .xml file', () => {
		expect( selectImporterClass( [ 'export.xml' ] ) ).toBe( WxrImporter );
	} );

	it( 'does not select the WxrImporter for a .sql file', () => {
		expect( selectImporterClass( [ 'backup.sql' ] ) ).not.toBe( WxrImporter );
	} );
} );

describe( 'BackupImporter extraction failures', () => {
	const site = { id: 'site-1', path: '/test/site' } as SiteData;

	class MockBackupHandler extends ImportExportEventEmitter {
		constructor( private extractError: Error ) {
			super();
		}
		listFiles = vi.fn( async () => [ 'backup.sql' ] );
		extractFiles = vi.fn( async () => {
			throw this.extractError;
		} );
	}

	function importerWithExtractError( extractError: Error ) {
		vi.mocked( BackupHandlerFactory.create ).mockReturnValue(
			new MockBackupHandler( extractError ) as never
		);
		return getImporter(
			{ path: '/tmp/backup.zip', type: 'application/zip' },
			DEFAULT_IMPORTER_OPTIONS
		);
	}

	it( 'wraps extraction failures in a LoggerError coded extract', async () => {
		const command = importerWithExtractError( new Error( 'unexpected end of file' ) ).import(
			site
		);

		await expect( command ).rejects.toThrow( LoggerError );
		await expect( command ).rejects.toMatchObject( {
			code: 'extract',
			message: 'Failed to extract backup: unexpected end of file',
		} );
	} );

	it( 'keeps a more specific code already carried by the extraction error', async () => {
		const command = importerWithExtractError(
			new LoggerError(
				'Input file at location "/tmp/backup.zip" could not be found.',
				undefined,
				'file_not_found'
			)
		).import( site );

		await expect( command ).rejects.toMatchObject( { code: 'file_not_found' } );
	} );
} );
