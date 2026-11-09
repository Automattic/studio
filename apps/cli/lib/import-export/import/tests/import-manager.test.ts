import { ImportEvents } from '@studio/common/lib/import-export-events';
import { describe, it, expect, vi } from 'vitest';
import { LoggerError } from 'cli/logger';
import { ImportExportEventEmitter } from '../../events';
import { BackupHandlerFactory } from '../handlers/backup-handler-factory';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from '../import-manager';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '../handlers/backup-handler-factory', () => ( {
	BackupHandlerFactory: { create: vi.fn() },
} ) );

describe( 'BackupImporter', () => {
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

	function importerWithExtractError( extractError: Error, files = [ 'backup.sql' ] ) {
		const handler = new MockBackupHandler( extractError );
		handler.listFiles.mockResolvedValue( files );
		vi.mocked( BackupHandlerFactory.create ).mockReturnValue( handler as never );
		return {
			handler,
			importer: getImporter(
				{ path: '/tmp/backup.zip', type: 'application/zip' },
				DEFAULT_IMPORTER_OPTIONS
			),
		};
	}

	it( 'wraps extraction failures in a LoggerError coded extract', async () => {
		const command = importerWithExtractError(
			new Error( 'unexpected end of file' )
		).importer.import( site );

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
		).importer.import( site );

		await expect( command ).rejects.toMatchObject( { code: 'file_not_found' } );
	} );

	it.each( [
		[ 'sql/wp_wffilemods.sql', 'sql/wp_wfFileMods.sql' ],
		[ 'app/sql/wp_wffilemods.sql', 'app/sql/wp_wfFileMods.sql' ],
		[ 'sql/wp_posts.sql', 'SQL/wp_posts.sql' ],
		[ 'sql/wp_posts.sql', './sql/wp_POSTS.sql' ],
		[ 'sql/wp_posts.sql', 'sql/wp_posts.SQL' ],
		[ 'sql/wp_posts.sql', 'sql\\wp_POSTS.sql' ],
	] )( 'rejects conflicting SQL files %s and %s before extraction', async ( first, second ) => {
		const { handler, importer } = importerWithExtractError( new Error( 'extraction reached' ), [
			first,
			second,
		] );
		const validationComplete = vi.fn();
		const importStart = vi.fn();
		importer.on( ImportEvents.IMPORT_VALIDATION_COMPLETE, validationComplete );
		importer.on( ImportEvents.IMPORT_START, importStart );

		const command = importer.import( site );
		await expect( command ).rejects.toMatchObject( { code: 'sql_file_name_conflict' } );
		await expect( command ).rejects.toThrow( first );
		await expect( command ).rejects.toThrow( second );
		expect( handler.extractFiles ).not.toHaveBeenCalled();
		expect( validationComplete ).not.toHaveBeenCalled();
		expect( importStart ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'sql/wp_posts.sql', 'sql/wp_postmeta.sql' ],
		[ 'sql/wp_posts.sql', 'sql/other/wp_posts.sql' ],
		[ 'sql/wp_posts.sql', 'sql/wp_posts.sql' ],
		[ 'sql/wp_posts.sql', 'wp-content/uploads/Photo.jpg', 'wp-content/uploads/photo.jpg' ],
	] )( 'continues to extraction for a non-conflicting manifest %j', async ( ...files ) => {
		const { handler, importer } = importerWithExtractError(
			new Error( 'extraction reached' ),
			files
		);

		await expect( importer.import( site ) ).rejects.toThrow( 'extraction reached' );
		expect( handler.extractFiles ).toHaveBeenCalledOnce();
	} );
} );
