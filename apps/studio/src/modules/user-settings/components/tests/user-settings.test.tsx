// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/user-settings.test.tsx` from the root directory
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { UserSettings } from 'src/modules/user-settings';
import { store } from 'src/stores';

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn( () => ( {
		platform: 'darwin',
	} ) ),
	isMac: vi.fn( () => true ),
	isWindows: vi.fn( () => false ),
	isWindowsStore: vi.fn( () => false ),
} ) );
vi.mock( 'src/hooks/use-feature-flags', () => ( {
	useFeatureFlags: vi.fn( () => ( { enableAgentSuite: false } ) ),
} ) );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-ipc-listener' );
vi.mock( 'src/hooks/use-offline' );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
		getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
			terminals: [ 'terminal' ],
			editors: [ 'vscode' ],
		} ),
		isStudioCliInstalled: vi.fn().mockResolvedValue( true ),
		copyText: vi.fn().mockResolvedValue( undefined ),
	} ),
} ) );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

const mockIpcEvent = {
	ports: [],
	sender: {} as unknown as Electron.IpcRenderer,
	preventDefault: vi.fn(),
	defaultPrevented: false,
};

describe( 'UserSettings', () => {
	beforeEach( () => {
		// Triggers IPC listener to show modal
		vi.mocked( useIpcListener ).mockImplementationOnce( ( listener, callback ) => {
			if ( listener === 'user-settings' ) {
				callback( mockIpcEvent, {} );
			}
		} );
	} );

	it( 'logs in when not authenticated', async () => {
		const authenticate = vi.fn();
		vi.mocked( useAuth ).mockReturnValue( {
			isAuthenticated: false,
			authenticate,
			logout: vi.fn(),
			client: undefined,
		} );
		renderWithProvider( <UserSettings /> );
		const loginButton = screen.getByRole( 'button', { name: 'Log in' } );
		expect( loginButton ).toBeVisible();
		await userEvent.click( loginButton );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'logs out if authenticated', async () => {
		const logout = vi.fn();
		vi.mocked( useAuth ).mockReturnValue( {
			isAuthenticated: true,
			logout,
			authenticate: vi.fn(),
			client: undefined,
		} );
		renderWithProvider( <UserSettings /> );
		const logoutButton = screen.getByRole( 'button', { name: 'Log out' } );
		expect( logoutButton ).toBeVisible();
		await userEvent.click( logoutButton );
		expect( logout ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables log in button when offline', async () => {
		const authenticate = vi.fn();
		vi.mocked( useOffline ).mockReturnValue( true );
		vi.mocked( useAuth ).mockReturnValue( {
			isAuthenticated: false,
			authenticate,
			logout: vi.fn(),
			client: undefined,
		} );
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
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

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
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'preferences' } ), 0 );
				}
			} );
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Preferences' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
			} );
		} );

		it( 'should open with usage tab when tabName is usage and user is authenticated', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'usage' } ), 0 );
				}
			} );
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Usage' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
			} );
		} );

		it( 'should default to first tab when no tabName is provided', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, {} ), 0 );
				}
			} );
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
		} );

		it( 'should not show usage tab for unauthenticated users even if specified', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'usage' } ), 0 );
				}
			} );
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: false,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.queryByText( 'Usage' ) ).not.toBeInTheDocument();
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
		} );
	} );
} );
