import { render, act, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Provider } from 'react-redux';
import TopBar from 'src/components/top-bar';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { store } from 'src/stores';

jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-offline' );

const mockOpenURL = jest.fn();
const mockAuthenticate = jest.fn();
const toggleMinWindowWidth = jest.fn();
jest.mock( 'src/lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: jest.fn(),
		generateProposedSitePath: jest.fn(),
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
		jest.clearAllMocks();
	} );
	it( 'Test unauthenticated TopBar has the Log in button', async () => {
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		expect(
			screen.queryByRole( 'button', { name: 'Open account settings' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Log in to Studio with WordPress.com' } )
		).toBeVisible();
	} );

	it( 'Test authenticated TopBar does not have the log in button and it has the settings and account buttons', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Open settings' } ) ).toBeVisible();
	} );

	it( 'shows offline indicator', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		await act( async () => renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		const offlineIndicator = screen.getByRole( 'button', {
			name: 'Offline indicator',
		} );
		expect( offlineIndicator ).toHaveAttribute( 'aria-description' );
		expect( offlineIndicator.getAttribute( 'aria-description' ) ).toContain( 'offline' );
	} );

	it( 'opens the support URL', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

		renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> );

		const helpIconButton = screen.getByRole( 'button', { name: 'Get help' } );
		await user.click( helpIconButton );
		await waitFor( () =>
			expect( mockOpenURL ).toHaveBeenCalledWith(
				`https://developer.wordpress.com/docs/developer-tools/studio/`
			)
		);
	} );

	it( 'calls toggleMinWindowWidth when sidebar toggle button is clicked', async () => {
		const user = userEvent.setup();
		const onToggleSidebar = jest.fn().mockImplementation( () => {
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
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
			( useOffline as jest.Mock ).mockReturnValue( true );

			renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> );

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
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
			( useOffline as jest.Mock ).mockReturnValue( false );

			renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> );

			const loginButton = screen.getByRole( 'button', {
				name: 'Log in to Studio with WordPress.com',
			} );
			expect( loginButton ).not.toBeDisabled();
		} );

		it( 'shows offline tooltip when offline and unauthenticated', async () => {
			const user = userEvent.setup();
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
			( useOffline as jest.Mock ).mockReturnValue( true );
			renderWithProvider( <TopBar onToggleSidebar={ jest.fn() } /> );
			const loginButton = screen.getByRole( 'button', {
				name: 'Log in to Studio with WordPress.com',
			} );
			expect( loginButton ).toBeDisabled();
			await user.hover( loginButton );
			expect( screen.getByText( "You're currently offline." ) ).toBeInTheDocument();
		} );
	} );
} );
