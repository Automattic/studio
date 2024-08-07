import { renderHook, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ExportEventType, ExportEvents } from '../../lib/import-export/export/events';
import { ImportEventType, ImportEvents } from '../../lib/import-export/import/events';
import { ImportExportProvider, useImportExport } from '../use-import-export';
import { useIpcListener } from '../use-ipc-listener';
import { useSiteDetails } from '../use-site-details';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-ipc-listener' );
jest.mock( '../use-site-details' );

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
		importSite: jest.fn(),
	} );
	( useSiteDetails as jest.Mock ).mockReturnValue( {
		updateSiteState: jest.fn(),
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
				site: selectedSite,
				backupFile: '/path/to/exported-site.tar.gz',
				includes: { database: true, uploads: true, plugins: true, themes: true },
				phpVersion: '8.0',
			},
			SITE_ID
		);
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				body: 'Export completed',
			} )
		);
	} );

	it( 'shows error message when export fails', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );

		( getIpcApi().exportSite as jest.Mock ).mockRejectedValue( 'error' );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		await act( () => result.current.exportFullSite( selectedSite ) );

		expect( result.current.exportState ).toEqual( {} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith(
			{
				site: selectedSite,
				backupFile: '/path/to/exported-site.tar.gz',
				includes: { database: true, uploads: true, plugins: true, themes: true },
				phpVersion: '8.0',
			},
			SITE_ID
		);
		expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'error', message: 'Failed exporting site' } )
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
				site: selectedSite,
				backupFile: '/path/to/exported-database.sql',
				includes: { database: true, uploads: false, plugins: false, themes: false },
				phpVersion: '8.0',
			},
			SITE_ID
		);
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				body: 'Export completed',
			} )
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

		emitExportEvent( SITE_ID, ExportEvents.EXPORT_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Starting export...',
				progress: 5,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Creating backup...',
				progress: 10,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.CONFIG_EXPORT_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration...',
				progress: 15,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.CONFIG_EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration...',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 0, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 2, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 60,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 4, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files...',
				progress: 100,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Export completed',
				progress: 100,
			},
		} );
	} );

	it( 'imports site', async () => {
		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );
		await act( () => result.current.clearImportState( selectedSite.id ) );

		expect( result.current.importState ).toEqual( {} );
		expect( getIpcApi().importSite ).toHaveBeenCalledWith( {
			id: SITE_ID,
			backupFile: {
				type: 'application/zip',
				path: 'backup.zip',
			},
		} );
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				body: 'Import completed',
			} )
		);
	} );

	it( 'shows error message when import fails', async () => {
		( getIpcApi().importSite as jest.Mock ).mockRejectedValue( 'error' );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		expect( result.current.exportState ).toEqual( {} );
		expect( getIpcApi().importSite ).toHaveBeenCalledWith( {
			id: SITE_ID,
			backupFile: {
				type: 'application/zip',
				path: 'backup.zip',
			},
		} );
		expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
			expect.objectContaining( { type: 'error', message: 'Failed importing site' } )
		);
	} );

	it( 'does not import if another import is running', async () => {
		let onEvent: ( ...args: any[] ) => void = jest.fn();
		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-import' ) {
				onEvent = callback;
			}
		} );
		const emitImportEvent = ( siteId: string, event: ImportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );
		// Mock import state of selected site
		emitImportEvent( SITE_ID, ImportEvents.BACKUP_EXTRACT_PROGRESS, { progress: 0.5 } );

		await act( () => result.current.importFile( file, selectedSite ) );

		expect( getIpcApi().importSite ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'updates the import state when receiving import events', async () => {
		let onEvent: ( ...args: any[] ) => void = jest.fn();
		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-import' ) {
				onEvent = callback;
			}
		} );
		const emitImportEvent = ( siteId: string, event: ImportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		emitImportEvent( SITE_ID, ImportEvents.BACKUP_EXTRACT_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Extracting backup…',
				progress: 5,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.BACKUP_EXTRACT_PROGRESS, { progress: 0.5 } );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Extracting backup files…',
				progress: 27.5,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing backup…',
				progress: 55,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_DATABASE_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing database…',
				progress: 60,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_DATABASE_COMPLETE );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing database…',
				progress: 80,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing WordPress content…',
				progress: 80,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_COMPLETE );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing WordPress content…',
				progress: 95,
				isNewSite: false,
			},
		} );

		emitImportEvent( SITE_ID, ImportEvents.IMPORT_COMPLETE );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing completed',
				progress: 100,
				isNewSite: false,
			},
		} );
	} );

	it( 'imports site with given studio.json PHP version', async () => {
		const importedSite = { ...selectedSite, phpVersion: '7.4' };
		( getIpcApi().importSite as jest.Mock ).mockResolvedValue( importedSite );

		const mockUpdateSiteState = jest.fn();
		( useSiteDetails as jest.Mock ).mockReturnValue( { updateSiteState: mockUpdateSiteState } );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		expect( mockUpdateSiteState ).toHaveBeenCalledTimes( 1 );
		expect( mockUpdateSiteState ).toHaveBeenCalledWith( importedSite );
	} );
} );
