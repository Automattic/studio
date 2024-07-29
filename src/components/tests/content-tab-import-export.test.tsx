import { IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import { render, fireEvent, waitFor, screen, createEvent, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useIpcListener } from '../../hooks/use-ipc-listener';
import { useSiteDetails } from '../../hooks/use-site-details';
import { exportSite } from '../../ipc-handlers';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ExportEventType, ExporterEvents } from '../../lib/import-export/export/events';
import { ContentTabImportExport } from '../content-tab-import-export';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-ipc-listener' );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
};

const mockFiles = [
	'wp-config.php',
	'wp-content/uploads/image.jpg',
	'wp-content/plugins/plugin.php',
	'wp-content/themes/theme/style.css',
];

beforeEach( () => {
	jest.clearAllMocks();
	( useSiteDetails as jest.Mock ).mockReturnValue( {
		importFile: jest.fn(),
		updateSite: jest.fn(),
		startServer: jest.fn(),
		loadingServer: {},
	} );

	( getIpcApi as jest.Mock ).mockReturnValue( {
		showSaveAsDialog: jest.fn(),
		showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ), // Mock showMessageBox
		showNotification: jest.fn(),
		openURL: jest.fn(),
		openSiteURL: jest.fn(),
		exportSite: jest.fn( ( options ) => exportSite( {} as IpcMainInvokeEvent, options ) ),
	} );
	( fs.readdir as jest.Mock ).mockResolvedValue(
		mockFiles.map( ( file ) => ( {
			isFile: () => true,
			path: '/test-site',
			name: file,
		} ) )
	);
} );

describe( 'ContentTabImportExport Import', () => {
	test( 'should display drop text on file over', () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		expect( dropZone ).toBeInTheDocument();

		fireEvent.dragOver( dropZone );
		expect( screen.getByText( /Drop file/i ) ).toBeInTheDocument();
	} );

	test( 'should display inital text on drop leave', () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		expect( dropZone ).toBeInTheDocument();

		fireEvent.dragOver( dropZone );
		expect( screen.getByText( /Drop file/i ) ).toBeInTheDocument();

		jest.useFakeTimers();
		act( () => {
			const dragLeaveEvent = createEvent.dragLeave( dropZone );
			fireEvent( dropZone, dragLeaveEvent );
			jest.runAllTimers();
		} );

		expect(
			screen.getByText( /Drag a file here, or click to select a file/i )
		).toBeInTheDocument();
		jest.useRealTimers();
	} );

	test( 'should import a site via drag-and-drop', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'application/zip' } );

		fireEvent.dragEnter( dropZone );
		fireEvent.dragOver( dropZone );
		const dropEvent = createEvent.drop( dropZone, { dataTransfer: { files: [ file ] } } );
		fireEvent( dropZone, dropEvent );

		await waitFor( () =>
			expect( useSiteDetails().importFile ).toHaveBeenCalledWith( file, selectedSite )
		);
	} );

	test( 'should import a site via file selection', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );
		const fileInput = screen.getByTestId( 'backup-file' );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'application/zip' } );

		await userEvent.upload( fileInput, file );

		expect( useSiteDetails().importFile ).toHaveBeenCalledWith( file, selectedSite );
	} );
} );

describe( 'ContentTabImportExport Export', () => {
	test( 'should export full site', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export entire site/i } );
		fireEvent.click( exportButton );

		await waitFor( () =>
			expect( getIpcApi().exportSite ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sitePath: selectedSite.path,
					backupFile: '/path/to/exported-site.tar.gz',
				} )
			)
		);
	} );

	test( 'should export database', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-database.sql' );
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export database/i } );
		fireEvent.click( exportButton );

		await waitFor( () =>
			expect( getIpcApi().exportSite ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sitePath: selectedSite.path,
					backupFile: '/path/to/exported-database.sql',
				} )
			)
		);
	} );

	test( 'should display progress when exporting', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );
		let onEvent: ( ...args: any[] ) => void = jest.fn();
		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		const emitExportEvent = ( event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data } ) );

		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export entire site/i } );
		fireEvent.click( exportButton );

		emitExportEvent( ExporterEvents.EXPORT_START );
		expect(
			screen.queryByRole( 'button', { name: /Export entire site/i } )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'Starting export...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 5 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.BACKUP_CREATE_START );
		expect( screen.getByText( 'Creating backup...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 10 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.CONFIG_EXPORT_START );
		expect( screen.getByText( 'Exporting configuration...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 15 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.CONFIG_EXPORT_COMPLETE );
		expect( screen.getByText( 'Exporting configuration...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 20 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 0, total: 4 } },
		} );
		expect( screen.getByText( 'Backing up files...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 20 } } ) ).toBeVisible();
		emitExportEvent( ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 2, total: 4 } },
		} );
		expect( screen.getByRole( 'progressbar', { value: { now: 60 } } ) ).toBeVisible();
		emitExportEvent( ExporterEvents.BACKUP_CREATE_PROGRESS, {
			progress: { entries: { processed: 4, total: 4 } },
		} );
		expect( screen.getByRole( 'progressbar', { value: { now: 100 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.EXPORT_COMPLETE );
		expect( screen.getByText( 'Export completed' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 100 } } ) ).toBeVisible();
		expect( getIpcApi().showNotification ).toHaveBeenCalledWith( {
			title: 'Test Site',
			body: 'Export completed',
		} );
	} );

	test( 'should display error if export fails', async () => {
		const mockShowSaveAsDialog = getIpcApi().showSaveAsDialog as jest.Mock;
		mockShowSaveAsDialog.mockResolvedValue( '/path/to/exported-site.tar.gz' );
		let onEvent: ( ...args: any[] ) => void = jest.fn();
		( useIpcListener as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'on-export' ) {
				onEvent = callback;
			}
		} );

		( getIpcApi().exportSite as jest.Mock ).mockRejectedValue( 'Error' );

		const emitExportEvent = ( event: ExportEventType, data: unknown = {} ) =>
			act( () => onEvent( null, { event, data } ) );

		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export entire site/i } );
		fireEvent.click( exportButton );

		emitExportEvent( ExporterEvents.EXPORT_START );
		expect(
			screen.queryByRole( 'button', { name: /Export entire site/i } )
		).not.toBeInTheDocument();
		expect( screen.getByText( 'Starting export...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 5 } } ) ).toBeVisible();

		emitExportEvent( ExporterEvents.EXPORT_ERROR );
		expect( screen.getByText( 'Export failed. Please try again.' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 5 } } ) ).toBeVisible();
		await waitFor( () =>
			expect( getIpcApi().showMessageBox ).toHaveBeenCalledWith(
				expect.objectContaining( {
					type: 'error',
					message: 'Failed exporting site',
					detail:
						'An error occurred while exporting the site. If this problem persists, please contact support.',
				} )
			)
		);
		expect( screen.getByRole( 'button', { name: /Export entire site/i } ) ).toBeVisible();
	} );
} );
