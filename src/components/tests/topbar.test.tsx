import { fireEvent, render, act, waitFor, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useAuth } from '../../hooks/use-auth';
import { useOffline } from '../../hooks/use-offline';
import TopBar from '../top-bar';

jest.mock( '../../hooks/use-auth' );

const mockOpenURL = jest.fn();
const toggleMinWindowWidth = jest.fn();
jest.mock( '../../lib/get-ipc-api', () => ( {
	__esModule: true,
	default: jest.fn(),
	getIpcApi: () => ( {
		showOpenFolderDialog: jest.fn(),
		generateProposedSitePath: jest.fn(),
		openURL: mockOpenURL,
		toggleMinWindowWidth,
	} ),
} ) );

describe( 'TopBar', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );
	it( 'Test unauthenticated TopBar has the Log in button', async () => {
		const user = userEvent.setup();
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		await act( async () => render( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		expect( screen.getByRole( 'button', { name: 'Log in' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'Test authenticated TopBar does not have the log in button and it has the settings and account buttons', async () => {
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );
		await act( async () => render( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Account' } ) ).toBeVisible();
	} );
	it( 'disables log in button when offline', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );
		await act( async () => render( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.mouseOver( loginButton );
		expect( screen.getByRole( 'tooltip', { name: 'You’re currently offline.' } ) ).toBeVisible();
	} );

	it( 'shows offline indicator', async () => {
		( useOffline as jest.Mock ).mockReturnValue( true );
		await act( async () => render( <TopBar onToggleSidebar={ jest.fn() } /> ) );
		const offlineIndicator = screen.getByRole( 'button', {
			name: 'Offline indicator',
		} );
		fireEvent.mouseOver( offlineIndicator );
		expect(
			screen.getByRole( 'tooltip', {
				name: 'You’re currently offline. Some features will be unavailable.',
			} )
		).toBeVisible();
	} );

	it( 'opens the support URL', async () => {
		const user = userEvent.setup();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

		render( <TopBar onToggleSidebar={ jest.fn() } /> );

		const helpIconButton = screen.getByRole( 'button', { name: 'Help' } );
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

		render( <TopBar onToggleSidebar={ onToggleSidebar } /> );

		const toggleButton = screen.getByRole( 'button', { name: 'Toggle Sidebar' } );
		await user.click( toggleButton );

		expect( onToggleSidebar ).toHaveBeenCalledTimes( 1 );
		expect( toggleMinWindowWidth ).toHaveBeenCalledTimes( 1 );
	} );
} );
