import { render, act, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import TopBar from 'src/components/top-bar';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { store } from 'src/stores';

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-offline' );
vi.mock( 'src/lib/app-globals', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/lib/app-globals') >() ),
	isWindows: () => false,
} ) );

const mockOpenURL = vi.fn();
const mockAuthenticate = vi.fn();
const toggleMinWindowWidth = vi.fn();
vi.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: vi.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: vi.fn(),
		generateProposedSitePath: vi.fn(),
		openURL: mockOpenURL,
		authenticate: mockAuthenticate,
		toggleMinWindowWidth,
	} ),
} ) );

const renderWithProvider = ( children: React.ReactElement ) => {
	return render( <Provider store={ store }>{ children }</Provider> );
};

describe( 'TopBar', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );
	it( 'Test unauthenticated TopBar has the Log in button', async () => {
		const authenticate = vi.fn();
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: false,
			authenticate,
		} );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> ) );
		expect(
			screen.queryByRole( 'button', { name: 'Open account settings' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Log in to Studio with WordPress.com' } )
		).toBeVisible();
	} );

	it( 'Test authenticated TopBar does not have the log in button and it has the settings and account buttons', async () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: true } );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> ) );
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Open settings' } ) ).toBeVisible();
	} );

	it( 'shows offline indicator', async () => {
		vi.mocked( useOffline ).mockReturnValue( true );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> ) );
		const offlineIndicator = screen.getByRole( 'status', {
			name: 'Offline indicator',
		} );
		expect( offlineIndicator ).toHaveAttribute( 'aria-description' );
		expect( offlineIndicator ).toHaveAttribute(
			'aria-description',
			expect.stringContaining( 'offline' )
		);
	} );

	it( 'opens the docs URL from the help menu', async () => {
		const user = userEvent.setup();
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: true } );

		renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );

		await user.click( screen.getByRole( 'button', { name: 'Help' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Docs' } ) );

		await waitFor( () =>
			expect( mockOpenURL ).toHaveBeenCalledWith(
				`https://developer.wordpress.com/docs/developer-tools/studio/`
			)
		);
	} );

	it( 'opens the feedback modal from the help menu', async () => {
		const user = userEvent.setup();
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: true } );

		renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );

		await user.click( screen.getByRole( 'button', { name: 'Help' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: 'Send feedback' } ) );

		expect( await screen.findByText( 'Share feedback' ) ).toBeVisible();
	} );

	it( 'calls toggleMinWindowWidth when sidebar toggle button is clicked', async () => {
		const user = userEvent.setup();
		const onToggleSidebar = vi.fn().mockImplementation( () => {
			toggleMinWindowWidth( true );
		} );

		renderWithProvider( <TopBar onToggleSidebar={ onToggleSidebar } /> );

		const toggleButton = screen.getByRole( 'button', { name: 'Toggle sidebar' } );
		await user.click( toggleButton );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
		expect( toggleMinWindowWidth ).toHaveBeenCalledTimes( 1 );
	} );

	describe( 'login button with offline state', () => {
		it( 'disables login button when offline and unauthenticated', async () => {
			const user = userEvent.setup();
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
			vi.mocked( useOffline ).mockReturnValue( true );

			renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );

			const loginButton = screen.getByRole( 'button', {
				name: 'Log in to Studio with WordPress.com',
			} );
			expect( loginButton ).toBeDisabled();
			// Try to click the disabled button
			await user.click( loginButton );

			// Authentication should not be called since button is disabled
			expect( mockAuthenticate ).not.toHaveBeenCalled();
		} );

		it( 'enables login button when online and unauthenticated', async () => {
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
			vi.mocked( useOffline ).mockReturnValue( false );

			renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );

			const loginButton = screen.getByRole( 'button', {
				name: 'Log in to Studio with WordPress.com',
			} );
			expect( loginButton ).toBeEnabled();
		} );

		it( 'disables login button when offline and unauthenticated', () => {
			vi.mocked( useAuth, { partial: true } ).mockReturnValue( { isAuthenticated: false } );
			vi.mocked( useOffline ).mockReturnValue( true );
			renderWithProvider( <TopBar onToggleSidebar={ vi.fn() } /> );
			const loginButton = screen.getByRole( 'button', {
				name: 'Log in to Studio with WordPress.com',
			} );
			expect( loginButton ).toBeDisabled();
		} );
	} );
} );
