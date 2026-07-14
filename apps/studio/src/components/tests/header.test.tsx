import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi, beforeAll, type Mock } from 'vitest';
import Header from 'src/components/header';
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
		phpVersion: '8.4',
	},
];

function mockGetIpcApi( mocks: Record< string, Mock > ) {
	vi.mocked( getIpcApi ).mockReturnValue( {
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getSiteDetails: vi.fn( () => Promise.resolve( mockedSites ) ),
		fetchSnapshots: vi.fn( () => Promise.resolve( [] ) ),
		setSnapshot: vi.fn(),
		startServer: vi.fn( () => Promise.resolve() ),
		showErrorMessageBox: vi.fn(),
		...mocks,
	} as unknown as IpcApi );
}

const renderWithProvider = ( children: React.ReactElement ) => {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>
				<SiteDetailsProvider>{ children }</SiteDetailsProvider>
			</ContentTabsProvider>
		</Provider>
	);
};

describe( 'Header', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should start site servers', async () => {
		const user = userEvent.setup();
		mockGetIpcApi( {} );
		renderWithProvider( <Header /> );

		await screen.findByText( 'test-1' );
		const startButton = screen.getByRole( 'button', { name: 'Start' } );
		await user.click( startButton );

		expect( vi.mocked( getIpcApi )().startServer ).toHaveBeenCalledTimes( 1 );
	} );

	describe( 'site navigation links (IPC command boundary)', () => {
		it( 'opens the local site homepage without auto-login', async () => {
			const user = userEvent.setup();
			mockGetIpcApi( { openSiteURL: vi.fn() } );
			renderWithProvider( <Header /> );

			await screen.findByText( 'test-1' );
			await user.click( screen.getByRole( 'button', { name: /Open local site/ } ) );

			expect( vi.mocked( getIpcApi )().startServer ).toHaveBeenCalledWith( 'mock-id' );
			expect( vi.mocked( getIpcApi )().openSiteURL ).toHaveBeenCalledWith( 'mock-id', '', {
				autoLogin: false,
			} );
		} );

		it( 'opens wp-admin with auto-login', async () => {
			const user = userEvent.setup();
			mockGetIpcApi( { openSiteURL: vi.fn() } );
			renderWithProvider( <Header /> );

			await screen.findByText( 'test-1' );
			await user.click( screen.getByRole( 'button', { name: /WP admin/ } ) );

			expect( vi.mocked( getIpcApi )().startServer ).toHaveBeenCalledWith( 'mock-id' );
			expect( vi.mocked( getIpcApi )().openSiteURL ).toHaveBeenCalledWith(
				'mock-id',
				'/wp-admin/'
			);
		} );
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
				title: "Failed to start 'test-1'",
				message:
					"Please verify your site's local path directory contains the standard WordPress installation files and try again. If this problem persists, please contact support.",
				error,
				showOpenLogs: true,
			} );
		} );
	} );
} );
