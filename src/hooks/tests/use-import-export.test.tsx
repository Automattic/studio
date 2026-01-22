import { renderHook, act } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { ImportExportProvider, useImportExport } from 'src/hooks/use-import-export';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ExportEventType, ExportEvents } from 'src/lib/import-export/export/events';
import { ImportEventType, ImportEvents } from 'src/lib/import-export/import/events';

const mockShowSaveAsDialog = vi.fn();
const mockShowErrorMessageBox = vi.fn();
const mockShowNotification = vi.fn();
const mockExportSite = vi.fn();
const mockImportSite = vi.fn();
const mockUpdateSite = vi.fn();
const mockStartServer = vi.fn();
const mockStopServer = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		showSaveAsDialog: mockShowSaveAsDialog,
		showErrorMessageBox: mockShowErrorMessageBox,
		showNotification: mockShowNotification,
		exportSite: mockExportSite,
		importSite: mockImportSite,
	} ),
} ) );

vi.mock( 'src/hooks/use-ipc-listener' );

vi.mock( 'src/hooks/use-site-details', () => ( {
	useSiteDetails: () => ( {
		updateSite: mockUpdateSite,
		startServer: mockStartServer,
		stopServer: mockStopServer,
	} ),
} ) );

const SITE_ID = 'site-id-1';

const selectedSite: SiteDetails = {
	id: SITE_ID,
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.3',
	adminPassword: btoa( 'test-password' ),
	port: 9999,
};

const wrapper = ( { children }: { children: React.ReactNode } ) => (
	<ImportExportProvider>{ children }</ImportExportProvider>
);

beforeEach( () => {
	vi.clearAllMocks();
	mockExportSite.mockReturnValue( true );
	mockImportSite.mockReturnValue( selectedSite );
} );

describe( 'useImportExport hook', () => {
	it( 'exports entire site', async () => {
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );

		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( siteId: string, event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );

		// Clear any existing export state first
		act( () => result.current.clearExportState( SITE_ID ) );

		await act( () => result.current.exportFullSite( selectedSite ) );

		// Simulate the export completion event
		emitExportEvent( SITE_ID, ExportEvents.EXPORT_COMPLETE );

		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Site export completed',
				progress: 100,
				exportType: 'full',
			},
		} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith( {
			site: selectedSite,
			backupFile: '/path/to/exported-site.tar.gz',
			includes: {
				database: true,
				wpContent: true,
			},
			phpVersion: '8.3',
		} );
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				body: 'Export completed',
			} )
		);
	} );

	it( 'shows error message when export fails', async () => {
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );

		mockExportSite.mockRejectedValue( 'error' );

		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( siteId: string, event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );

		// Clear any existing export state first
		act( () => result.current.clearExportState( SITE_ID ) );

		await act( () => result.current.exportFullSite( selectedSite ) );

		// Simulate the export error event
		emitExportEvent( SITE_ID, ExportEvents.EXPORT_ERROR );

		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Export failed. Please try again.',
				progress: 100,
				exportType: 'full',
			},
		} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith( {
			site: selectedSite,
			backupFile: '/path/to/exported-site.tar.gz',
			includes: {
				database: true,
				wpContent: true,
			},
			phpVersion: '8.3',
		} );
		expect( getIpcApi().showErrorMessageBox ).toHaveBeenCalledWith( {
			title: 'Failed exporting site',
			message:
				'An error occurred while exporting the site. If this problem persists, please contact support.',
			error: 'error',
			showOpenLogs: true,
		} );
	} );

	it( 'exports database', async () => {
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-database.sql' );

		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( siteId: string, event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );

		// Clear any existing export state first
		act( () => result.current.clearExportState( SITE_ID ) );

		await act( () => result.current.exportDatabase( selectedSite ) );

		// Simulate the export completion event
		emitExportEvent( SITE_ID, ExportEvents.EXPORT_COMPLETE );

		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Database export completed',
				progress: 100,
				exportType: 'database',
			},
		} );
		expect( getIpcApi().exportSite ).toHaveBeenCalledWith( {
			site: selectedSite,
			backupFile: '/path/to/exported-database.sql',
			includes: {
				database: true,
				wpContent: false,
			},
			phpVersion: '8.3',
		} );
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith(
			expect.objectContaining( {
				body: 'Export completed',
			} )
		);
	} );

	it( 'updates the export state when receiving export events', () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
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
				statusMessage: 'Starting export…',
				progress: 5,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Creating backup…',
				progress: 10,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.CONFIG_EXPORT_START );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration…',
				progress: 15,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.CONFIG_EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Exporting configuration…',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 0, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files…',
				progress: 20,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 2, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files…',
				progress: 60,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 4, total: 4 } },
		} );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Backing up files…',
				progress: 95,
			},
		} );

		emitExportEvent( SITE_ID, ExportEvents.EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Site export completed',
				progress: 100,
			},
		} );
	} );

	it( 'clears export state when clearExportState is called', () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( siteId: string, event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );

		// Set up a completed export state
		emitExportEvent( SITE_ID, ExportEvents.EXPORT_COMPLETE );
		expect( result.current.exportState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Site export completed',
				progress: 100,
			},
		} );

		// Clear the export state
		act( () => result.current.clearExportState( SITE_ID ) );
		expect( result.current.exportState ).toEqual( {} );
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
		expect( useSiteDetails().startServer ).toHaveBeenCalledTimes( 1 );
		expect( useSiteDetails().startServer ).toHaveBeenCalledWith( SITE_ID );
	} );

	it( 'shows error message when import fails with absolute path error', async () => {
		mockImportSite.mockRejectedValue( new Error( 'Error: absolute path: /' ) );

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
		expect( getIpcApi().showErrorMessageBox ).toHaveBeenCalledWith( {
			title: 'Failed importing site',
			message:
				'The ZIP archive is invalid. Try to unpack and pack it again. If this problem persists, please contact support.',
		} );
	} );

	it( 'shows error message when import fails with other error', async () => {
		mockImportSite.mockRejectedValue( new Error( 'generic error' ) );

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
		expect( getIpcApi().showErrorMessageBox ).toHaveBeenCalledWith( {
			title: 'Failed importing site',
			message:
				'An error occurred while importing the site. Verify the file is a valid Jetpack backup, Local, Playground, .wpress or .sql database file and try again. If this problem persists, please contact support.',
			error: new Error( 'generic error' ),
			showOpenLogs: true,
		} );
	} );

	it( 'does not import if another import is running', async () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
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
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
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
				statusMessage: 'Extracting backup files…',
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
				progress: 90,
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

	it( 'imports site with given meta.json PHP version', async () => {
		const importedSite = { ...selectedSite, phpVersion: '7.4' };
		mockImportSite.mockResolvedValue( importedSite );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		expect( useSiteDetails().updateSite ).toHaveBeenCalledWith( importedSite );
	} );

	it( 'handles verbose backup extraction progress with file counts', async () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-import' ) {
				onEvent = callback;
			}
		} );
		const emitImportEvent = ( siteId: string, event: ImportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		// Test extraction progress with file count data
		emitImportEvent( SITE_ID, ImportEvents.BACKUP_EXTRACT_PROGRESS, {
			progress: 0.5,
			processedFiles: 123,
			totalFiles: 250,
			currentFile: 'wp-content/themes/twentytwentythree/style.css',
			extractedBytes: 1024000,
			totalBytes: 2048000,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Extracting backup… (49%)',
				progress: 27.5, // 5 + (0.5 * 45)
				isNewSite: false,
			},
		} );

		// Test extraction progress without file count data (fallback)
		emitImportEvent( SITE_ID, ImportEvents.BACKUP_EXTRACT_PROGRESS, {
			progress: 0.8,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Extracting backup files…',
				progress: 41, // 5 + (0.8 * 45)
				isNewSite: false,
			},
		} );
	} );

	it( 'handles verbose database import progress', async () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-import' ) {
				onEvent = callback;
			}
		} );
		const emitImportEvent = ( siteId: string, event: ImportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		// Start database import
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_DATABASE_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing database…',
				progress: 60,
				isNewSite: false,
			},
		} );

		// Test database progress with SQL file tracking
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_DATABASE_PROGRESS, {
			currentFile: 'database1.sql',
			processedFiles: 1,
			totalFiles: 3,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing database… (33%)',
				progress: Math.min( 80, 60 + ( 1 / 3 ) * 20 ), // ~66.67
				isNewSite: false,
			},
		} );

		// Test database progress with multiple files
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_DATABASE_PROGRESS, {
			currentFile: 'database2.sql',
			processedFiles: 2,
			totalFiles: 3,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing database… (67%)',
				progress: Math.min( 80, 60 + ( 2 / 3 ) * 20 ), // ~73.33
				isNewSite: false,
			},
		} );
	} );

	it( 'handles verbose WordPress content import progress with categorization', async () => {
		let onEvent: ( ...args: any[] ) => void = vi.fn();
		vi.mocked( useIpcListener ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-import' ) {
				onEvent = callback;
			}
		} );
		const emitImportEvent = ( siteId: string, event: ImportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data }, siteId ) );

		const { result } = renderHook( () => useImportExport(), { wrapper } );
		const file = { path: 'backup.zip', type: 'application/zip' };
		await act( () => result.current.importFile( file, selectedSite ) );

		// Start WordPress content import
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_START );
		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing WordPress content…',
				progress: 5, // Progress is preserved from the initial import file call
				isNewSite: false,
			},
		} );

		// Test plugins import progress
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
			type: 'plugins',
			currentItem: 'wp-content/plugins/akismet/akismet.php',
			processedItems: 5,
			totalItems: 12,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing plugins… (42%)',
				progress: Math.min( 90, 80 + ( 5 / 12 ) * 10 ), // ~84.17
				isNewSite: false,
			},
		} );

		// Test themes import progress
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
			type: 'themes',
			currentItem: 'wp-content/themes/twentytwentythree/style.css',
			processedItems: 2,
			totalItems: 3,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing themes… (67%)',
				progress: Math.min( 90, 80 + ( 2 / 3 ) * 10 ), // ~86.67
				isNewSite: false,
			},
		} );

		// Test uploads import progress
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
			type: 'uploads',
			currentItem: 'wp-content/uploads/2024/01/image.jpg',
			processedItems: 150,
			totalItems: 500,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing media uploads… (30%)',
				progress: Math.min( 90, 80 + ( 150 / 500 ) * 10 ), // 83
				isNewSite: false,
			},
		} );

		// Test other files import progress
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
			type: 'other',
			currentItem: 'wp-content/index.php',
			processedItems: 10,
			totalItems: 25,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing other files… (40%)',
				progress: Math.min( 90, 80 + ( 10 / 25 ) * 10 ), // 84
				isNewSite: false,
			},
		} );

		// Test fallback for unknown content type
		emitImportEvent( SITE_ID, ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
			type: 'unknown',
			processedItems: 10,
			totalItems: 25,
		} );

		expect( result.current.importState ).toEqual( {
			[ SITE_ID ]: {
				statusMessage: 'Importing files… (40%)',
				progress: Math.min( 90, 80 + ( 10 / 25 ) * 10 ), // 84
				isNewSite: false,
			},
		} );
	} );
} );
