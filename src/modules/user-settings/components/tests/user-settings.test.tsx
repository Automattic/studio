// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/user-settings.test.tsx` from the root directory
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { UserSettings } from 'src/modules/user-settings';
import { store } from 'src/stores';

jest.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: jest.fn( () => ( {
		platform: 'darwin',
	} ) ),
	isMac: jest.fn( () => true ),
	isWindows: jest.fn( () => false ),
} ) );
jest.mock( 'src/hooks/use-feature-flags' );
jest.mock( 'src/hooks/use-auth' );
jest.mock( 'src/hooks/use-ipc-listener' );

jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
		getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
			terminals: [ 'terminal' ],
			editors: [ 'vscode' ],
		} ),
		isStudioCliInstalled: jest.fn().mockResolvedValue( true ),
	} ),
} ) );

afterEach( () => {
	jest.clearAllMocks();
} );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

describe( 'UserSettings', () => {
	beforeEach( () => {
		// Triggers IPC listener to show modal
		( useIpcListener as jest.Mock ).mockImplementationOnce( ( listener, callback ) => {
			if ( listener === 'user-settings' ) {
				callback( {}, {} );
			}
		} );
	} );

	it( 'logs in when not authenticated', async () => {
		const authenticate = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		renderWithProvider( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toBeVisible();
		await userEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'logs out if authenticated', async () => {
		const logout = jest.fn();
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true, logout } );
		renderWithProvider( <UserSettings /> );
		const logoutButton = screen.getByRole( 'button', { name: 'Log out' } );
		expect( logoutButton ).toBeVisible();
		await userEvent.click( logoutButton );
		expect( logout ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables log in button when offline', async () => {
		const authenticate = jest.fn();
		( useOffline as jest.Mock ).mockReturnValue( true );
		( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false, authenticate } );
		renderWithProvider( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toHaveAttribute( 'aria-disabled', 'true' );
		await userEvent.click( loginButton );
		expect( authenticate ).not.toHaveBeenCalled();
		await userEvent.hover( loginButton );
		expect(
			screen.getByRole( 'tooltip', {
				name: "You're currently offline.",
			} )
		).toBeVisible();
	} );

	describe( 'Tab Navigation', () => {
		it( 'switches between tabs correctly', async () => {
			const user = userEvent.setup();
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Log out' ) ).toBeInTheDocument();
			} );

			await user.click( screen.getByText( 'Preferences' ) );

			await waitFor( () => {
				expect( screen.getByText( 'Preferences' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Terminal application' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio CLI' ) ).toBeInTheDocument();
			} );

			await user.click( screen.getByText( 'Usage' ) );

			await waitFor( () => {
				expect( screen.getByText( 'Usage' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
				expect( screen.getByText( 'AI assistant' ) ).toBeInTheDocument();
			} );
		} );
	} );

	describe( 'Tab Selection via IPC', () => {
		it( 'should open with specified tab when tabName is provided via IPC', async () => {
			// Mock IPC listener with specific tab name and trigger modal show
			( useIpcListener as jest.Mock ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( {}, { tabName: 'preferences' } ), 0 );
				}
			} );
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Preferences' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
			} );
		} );

		it( 'should open with usage tab when tabName is usage and user is authenticated', async () => {
			( useIpcListener as jest.Mock ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( {}, { tabName: 'usage' } ), 0 );
				}
			} );
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Usage' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
			} );
		} );

		it( 'should default to first tab when no tabName is provided', async () => {
			( useIpcListener as jest.Mock ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( {}, {} ), 0 );
				}
			} );
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: true } );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
		} );

		it( 'should not show usage tab for unauthenticated users even if specified', async () => {
			( useIpcListener as jest.Mock ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( {}, { tabName: 'usage' } ), 0 );
				}
			} );
			( useAuth as jest.Mock ).mockReturnValue( { isAuthenticated: false } );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.queryByText( 'Usage' ) ).not.toBeInTheDocument();
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
		} );
	} );
} );
