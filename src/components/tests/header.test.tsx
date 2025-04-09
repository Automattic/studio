import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import Header from 'src/components/header';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

jest.mock( 'src/lib/get-ipc-api' );

const mockedGetIpcApi = getIpcApi as jest.Mock;
const mockedSites = [
	{
		name: 'test-1',
		path: '/fake/test-1',
		running: false,
		id: 'mock-id',
		port: 8881,
	},
];

function mockGetIpcApi( mocks: Record< string, jest.Mock > ) {
	mockedGetIpcApi.mockReturnValue( {
		getSiteDetails: jest.fn( () => Promise.resolve( mockedSites ) ),
		getSnapshots: jest.fn( () => Promise.resolve( [] ) ),
		openSiteURL: jest.fn(),
		saveSnapshotsToStorage: jest.fn( () => Promise.resolve() ),
		startServer: jest.fn( () => Promise.resolve( { running: true } ) ),
		showErrorMessageBox: jest.fn(),
		...mocks,
	} );
}

afterEach( () => {
	jest.clearAllMocks();
	jest.restoreAllMocks();
} );

describe( 'Header', () => {
	const renderWithProvider = ( children: React.ReactElement ) => {
		return render(
			<ContentTabsProvider>
				<SyncSitesProvider>
					<SiteDetailsProvider>{ children }</SiteDetailsProvider>
				</SyncSitesProvider>
			</ContentTabsProvider>
		);
	};
	it( 'should start site servers', async () => {
		const user = userEvent.setup();
		mockGetIpcApi( {} );
		renderWithProvider( <Header /> );

		await screen.findByText( 'test-1' );
		const startButton = screen.getByRole( 'button', { name: 'Start' } );
		await user.click( startButton );

		expect( mockedGetIpcApi().startServer ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Stop' ) ).toBeVisible();
	} );

	describe( 'when starting a server fails', () => {
		it( 'should display an error message', async () => {
			const user = userEvent.setup();
			const error = new Error( 'Failed to start the server' );
			mockGetIpcApi( {
				startServer: jest.fn( () => {
					throw error;
				} ),
				stopServer: jest.fn( () => Promise.resolve( { running: false } ) ),
			} );
			renderWithProvider( <Header /> );

			await screen.findByText( 'test-1' );
			const startButton = screen.getByRole( 'button', { name: 'Start' } );
			await user.click( startButton );

			expect( mockedGetIpcApi().startServer ).toHaveBeenCalledTimes( 1 );
			expect( screen.getByText( 'Start' ) ).toBeVisible();
			expect( mockedGetIpcApi().showErrorMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( mockedGetIpcApi().showErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Failed to start the site server',
				message:
					"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support.",
				error,
				showOpenLogs: true,
			} );
		} );
	} );

	describe( 'Manage database button', () => {
		it( 'should open the simple server when clicked', async () => {
			const user = userEvent.setup();
			renderWithProvider( <Header /> );

			await screen.findByText( 'test-1' );
			const startButton = screen.getByRole( 'button', { name: 'Start' } );
			await user.click( startButton );

			const manageDatabaseButton = screen.getAllByRole( 'button', { name: /Database/i } );
			await user.click( manageDatabaseButton[ 0 ] );

			expect( mockedGetIpcApi().startServer ).toHaveBeenCalled();
			expect( mockedGetIpcApi().openSiteURL ).toHaveBeenCalledWith( 'mock-id', '/adminer', {
				autoLogin: false,
			} );
		} );
	} );
} );
