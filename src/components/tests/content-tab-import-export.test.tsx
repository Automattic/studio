import { render, fireEvent, waitFor, screen, createEvent, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useSiteDetails } from '../../hooks/use-site-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabImportExport } from '../content-tab-import-export';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-site-details' );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
};

describe( 'ContentTabImportExport Import', () => {
	const mockImportFile = jest.fn();
	const mockUpdateSite = jest.fn();
	const mockStartServer = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
		( useSiteDetails as jest.Mock ).mockReturnValue( {
			importFile: mockImportFile,
			updateSite: mockUpdateSite,
			startServer: mockStartServer,
			loadingServer: {},
		} );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			showSaveAsDialog: jest.fn(),
			showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ), // Mock showMessageBox
			openURL: jest.fn(),
			openSiteURL: jest.fn(),
			exportSite: jest.fn(),
		} );
	} );

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

		await waitFor( () => expect( mockImportFile ).toHaveBeenCalledWith( file, selectedSite ) );
	} );

	test( 'should import a site via file selection', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );
		const fileInput = screen.getByTestId( 'backup-file' );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'application/zip' } );

		await userEvent.upload( fileInput, file );

		expect( mockImportFile ).toHaveBeenCalledWith( file, selectedSite );
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
} );
