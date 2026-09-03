import { render, fireEvent, waitFor, screen, createEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { act } from 'react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { ContentTabImportExport } from 'src/components/content-tab-import-export';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-site-details' );
vi.mock( 'src/hooks/use-import-export' );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.4',
	adminPassword: btoa( 'test-password' ),
	port: 9999,
};

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( useSiteDetails, { partial: true } ).mockReturnValue( {
		updateSite: vi.fn(),
		startServer: vi.fn(),
		loadingServer: {},
	} );
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		showMessageBox: vi.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ), // Mock showMessageBox
		isImportExportSupported: vi.fn().mockResolvedValue( true ),
	} );
	vi.mocked( useImportExport, { partial: true } ).mockReturnValue( {
		importFile: vi.fn(),
		importState: {},
		exportFullSite: vi.fn(),
		exportDatabase: vi.fn(),
		exportState: {},
	} );
} );

const renderWithProvider = ( children: React.ReactElement ) => {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>{ children }</ContentTabsProvider>
		</Provider>
	);
};

describe( 'ContentTabImportExport Import', () => {
	test( 'should display drop text on file over', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		expect( dropZone ).toBeInTheDocument();
		act( () => {
			fireEvent.dragOver( dropZone );
		} );
		expect( await screen.findByText( /Drop file/i ) ).toBeInTheDocument();
	} );

	test( 'should display initial text on drop leave', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		expect( dropZone ).toBeInTheDocument();

		fireEvent.dragOver( dropZone );
		expect( screen.getByText( /Drop file/i ) ).toBeInTheDocument();

		vi.useFakeTimers();
		act( () => {
			const dragLeaveEvent = createEvent.dragLeave( dropZone );
			fireEvent( dropZone, dragLeaveEvent );
			vi.runAllTimers();
		} );

		expect(
			screen.getByText( /Drag a file here, or click to select a file/i )
		).toBeInTheDocument();
	} );

	test( 'should import a site via drag-and-drop', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const dropZone = screen.getByText( /Drag a file here, or click to select a file/i );
		const file = new File( [ 'file contents' ], 'backup.sql', { type: 'application/sql' } );

		fireEvent.dragEnter( dropZone );
		fireEvent.dragOver( dropZone );
		const dropEvent = createEvent.drop( dropZone, { dataTransfer: { files: [ file ] } } );
		fireEvent( dropZone, dropEvent );

		await waitFor( () =>
			expect( useImportExport().importFile ).toHaveBeenCalledWith( file, selectedSite )
		);
	} );

	test( 'should import a site via file selection', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const fileInput = screen.getByTestId( 'backup-file' );
		expect( fileInput ).toBeInTheDocument();

		const file = new File( [ 'file contents' ], 'backup.sql', { type: 'application/sql' } );

		await userEvent.upload( fileInput, file );

		expect( useImportExport().importFile ).toHaveBeenCalledWith( file, selectedSite );
	} );

	test( 'should display progress when importing', async () => {
		vi.mocked( useImportExport, { partial: true } ).mockReturnValue( {
			importState: {
				'site-id-1': { progress: 5, statusMessage: 'Extracting backup…', isNewSite: false },
			},
			exportState: {},
		} );

		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		expect( screen.getByText( 'Extracting backup…' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );
} );

describe( 'ContentTabImportExport Export', () => {
	beforeEach( () => {
		// Reset all mocks before each test
		vi.clearAllMocks();
	} );

	test( 'should export full site', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const exportButton = screen.getByRole( 'button', { name: /Export entire site/i } );
		fireEvent.click( exportButton );

		expect( useImportExport().exportFullSite ).toHaveBeenCalledWith( selectedSite );
	} );

	test( 'should export database', async () => {
		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		const exportButton = screen.getByRole( 'button', { name: /Export database/i } );
		fireEvent.click( exportButton );

		expect( useImportExport().exportDatabase ).toHaveBeenCalledWith( selectedSite );
	} );

	test( 'should display progress when exporting', async () => {
		vi.mocked( useImportExport, { partial: true } ).mockReturnValue( {
			importState: {},
			exportState: { 'site-id-1': { progress: 5, statusMessage: 'Starting export…' } },
		} );

		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );
		await waitFor( () => {
			expect( screen.getByTestId( 'import-export-supported' ) ).toBeVisible();
		} );

		expect( screen.getByText( 'Starting export…' ) ).toBeVisible();
		expect( screen.getByRole( 'progressbar' ) ).toBeInTheDocument();
	} );

	test( 'should be blocked', async () => {
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			isImportExportSupported: vi.fn().mockResolvedValue( false ),
		} );

		renderWithProvider( <ContentTabImportExport selectedSite={ selectedSite } /> );

		await waitFor( () => {
			expect( screen.getByText( 'Import / Export is not available for this site' ) ).toBeVisible();
		} );
		expect(
			screen.queryByRole( 'button', { name: /Export entire site/i } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /Export database/i } ) ).not.toBeInTheDocument();
	} );
} );
