import { renderHook, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ExportEventType, ExporterEvents } from '../../lib/import-export/export/events';
import { ImportExportProvider, useImportExport } from '../use-import-export';
import { useIpcListener } from '../use-ipc-listener';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-ipc-listener' );

const SITE_ID = 'site-id-1';

const selectedSite: SiteDetails = {
	id: SITE_ID,
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
};

const wrapper = ( { children }: { children: React.ReactNode } ) => (
	<ImportExportProvider>{ children }</ImportExportProvider>
);

beforeEach( () => {
	jest.clearAllMocks();
	( getIpcApi as jest.Mock ).mockReturnValue( {
		showSaveAsDialog: jest.fn(),
		showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
		showNotification: jest.fn(),
		exportSite: jest.fn(),
	} );
} );

describe( 'useImportExport hook', () => {
	it( 'exports entire site', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		await act( () => result.current.exportFullSite( selectedSite ) );

		expect( result.current.exportState ).toEqual( {} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith(
			{
				sitePath: '/test-site',
				backupFile: '/path/to/exported-site.tar.gz',
				includes: { database: true, uploads: true, plugins: true, themes: true },
			},
			SITE_ID
		);
	} );
	it( 'exports database', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-database.sql' );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		await act( () => result.current.exportDatabase( selectedSite ) );

		expect( result.current.exportState ).toEqual( {} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith(
			{
				sitePath: '/test-site',
				backupFile: '/path/to/exported-database.sql',
				includes: { database: true, uploads: false, plugins: false, themes: false },
			},
			SITE_ID
		);
	} );

	it( 'updates the export state when receiving export events', () => {
		let onEvent: ( ...args: any[] ) => void = jest.fn();
		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( siteId: string, event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );

		emitExportEvent( SITE_ID, ExporterEvents.EXPORT_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Starting export...',
				progress: 5,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.BACKUP_CREATE_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Creating backup...',
				progress: 10,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.CONFIG_EXPORT_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration...',
				progress: 15,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.CONFIG_EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration...',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 0, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 2, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 60,
			},
		} );

		emitExportEvent( SITE_ID, ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 4, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 100,
			},
		} );
	} );
} );
