import { render, fireEvent, waitFor, screen, createEvent, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useImportExport } from '../../hooks/use-import-export';
import { useSiteDetails } from '../../hooks/use-site-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabImportExport } from '../content-tab-import-export';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-site-details' );
jest.mock( '../../hooks/use-import-export' );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
};

beforeEach( () => {
	jest.clearAllMocks();
	( useSiteDetails as jest.Mock ).mockReturnValue( {
		updateSite: jest.fn(),
		startServer: jest.fn(),
		loadingServer: {},
	} );
	( getIpcApi as jest.Mock ).mockReturnValue( {
		showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ), // Mock showMessageBox
		isImportExportSupported: jest.fn().mockResolvedValue( true ),
	} );
	( useImportExport as jest.Mock ).mockReturnValue( {
		importFile: jest.fn(),
		importState: {},
		exportFullSite: jest.fn(),
		exportDatabase: jest.fn(),
		exportState: {},
	} );
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
			expect( useImportExport().importFile ).toHaveBeenCalledWith( file, selectedSite )
		);
	} );

	test( 'should import a site via file selection', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );
		const fileInput = screen.getByTestId( 'backup-file' );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'application/zip' } );

		await userEvent.upload( fileInput, file );

		expect( useImportExport().importFile ).toHaveBeenCalledWith( file, selectedSite );
	} );

	test( 'should display progress when importing', async () => {
		( useImportExport as jest.Mock ).mockReturnValue( {
			importState: {
				'site-id-1': { progress: 5, statusMessage: 'Extracting backup…', isNewSite: false },
			},
			exportState: {},
		} );

		render( <ContentTabImportExport selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Extracting backup…' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 5 } } ) ).toBeVisible();
	} );
} );

describe( 'ContentTabImportExport Export', () => {
	beforeEach( () => {
		// Reset all mocks before each test
		jest.clearAllMocks();
	} );

	test( 'should export full site', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export entire site/i } );
		fireEvent.click( exportButton );

		expect( useImportExport().exportFullSite ).toHaveBeenCalledWith( selectedSite );
	} );

	test( 'should export database', async () => {
		render( <ContentTabImportExport selectedSite={ selectedSite } /> );

		const exportButton = screen.getByRole( 'button', { name: /Export database/i } );
		fireEvent.click( exportButton );

		expect( useImportExport().exportDatabase ).toHaveBeenCalledWith( selectedSite );
	} );

	test( 'should display progress when exporting', async () => {
		( useImportExport as jest.Mock ).mockReturnValue( {
			importState: {},
			exportState: { 'site-id-1': { progress: 5, statusMessage: 'Starting export...' } },
		} );

		render( <ContentTabImportExport selectedSite={ selectedSite } /> );
		expect( screen.getByText( 'Starting export...' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar', { value: { now: 5 } } ) ).toBeVisible();
	} );
} );
