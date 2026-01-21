import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi, type Mock } from 'vitest';
import Header from 'src/components/header';
import { SyncSitesProvider } from 'src/hooks/sync-sites';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { SiteDetailsProvider } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';

vi.mock( 'src/lib/get-ipc-api' );

beforeAll( () => {
	Object.defineProperty( window, 'ipcListener', {
		value: {
			subscribe: vi.fn().mockReturnValue( () => {} ),
		},
		writable: true,
	} );
} );
const mockedSites: SiteDetails[] = [
	{
		name: 'test-1',
		path: '/fake/test-1',
		running: false,
		id: 'mock-id',
		port: 8881,
		phpVersion: '8.3',
	},
];

<<<<<<< HEAD
function mockGetIpcApi( mocks: Record< string, Mock > ) {
	vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getSiteDetails: vi.fn( () => Promise.resolve( mockedSites ) ),
		getSnapshots: vi.fn( () => Promise.resolve( [] ) ),
		saveSnapshotsToStorage: vi.fn( () => Promise.resolve() ),
		startServer: vi.fn( () =>
			Promise.resolve( {
				...mockedSites[ 0 ],
				running: true,
				url: 'http://localhost:8881',
			} )
		),
		showErrorMessageBox: vi.fn(),
=======
function mockGetIpcApi( mocks: Record< string, jest.Mock > ) {
	mockedGetIpcApi.mockReturnValue( {
		getConnectedWpcomSites: jest.fn().mockResolvedValue( [] ),
		getSiteDetails: jest.fn( () => Promise.resolve( mockedSites ) ),
		getSnapshots: jest.fn( () => Promise.resolve( [] ) ),
		saveSnapshotsToStorage: jest.fn( () => Promise.resolve() ),
		startServer: jest.fn( () => Promise.resolve() ),
		showErrorMessageBox: jest.fn(),
>>>>>>> 3d31ad1e00b9363cc8c1fe93a3292145439494b5
		...mocks,
	} );
}

const renderWithProvider = ( children: React.ReactElement ) => {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>
				<SyncSitesProvider>
					<SiteDetailsProvider>{ children }</SiteDetailsProvider>
				</SyncSitesProvider>
			</ContentTabsProvider>
		</Provider>
	);
};

describe( 'Header', () => {
	afterEach( () => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
	} );

	it( 'should start site servers', async () => {
		const user = userEvent.setup();
		mockGetIpcApi( {} );
		renderWithProvider( <Header /> );

		await screen.findByText( 'test-1' );
		const startButton = screen.getByRole( 'button', { name: 'Start' } );
		await user.click( startButton );

<<<<<<< HEAD
		expect( vi.mocked( getIpcApi )().startServer ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Stop' ) ).toBeVisible();
=======
		expect( mockedGetIpcApi().startServer ).toHaveBeenCalledTimes( 1 );
>>>>>>> 3d31ad1e00b9363cc8c1fe93a3292145439494b5
	} );

	describe( 'when starting a server fails', () => {
		it( 'should display an error message', async () => {
			const user = userEvent.setup();
			const error = new Error( 'Failed to start the server' );
			mockGetIpcApi( {
				startServer: vi.fn( () => {
					throw error;
				} ),
				stopServer: vi.fn( () => Promise.resolve( mockedSites[ 0 ] ) ),
			} );
			renderWithProvider( <Header /> );

			await screen.findByText( 'test-1' );
			const startButton = screen.getByRole( 'button', { name: 'Start' } );
			await user.click( startButton );

			expect( vi.mocked( getIpcApi )().startServer ).toHaveBeenCalledTimes( 1 );
			expect( screen.getByText( 'Start' ) ).toBeVisible();
			expect( vi.mocked( getIpcApi )().showErrorMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( vi.mocked( getIpcApi )().showErrorMessageBox ).toHaveBeenCalledWith( {
				title: 'Failed to start the site server',
				message:
					"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support.",
				error,
				showOpenLogs: true,
			} );
		} );
	} );
} );
