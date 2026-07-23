// To run tests, execute `npm run test -- src/modules/user-settings/components/tests/user-settings.test.tsx` from the root directory
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { UserSettings } from 'src/modules/user-settings';
import { store } from 'src/stores';
import { installedAppsApi } from 'src/stores/installed-apps-api';

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn( () => ( {
		platform: 'darwin',
	} ) ),
	isMac: vi.fn( () => true ),
	isWindows: vi.fn( () => false ),
	isLinux: vi.fn( () => false ),
	isWindowsStore: vi.fn( () => false ),
} ) );
vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-ipc-listener' );
vi.mock( 'src/hooks/use-offline' );

const mockIpcApi = {
	getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
	getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
	getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
		antigravity: false,
		vscode: true,
		phpstorm: false,
		webstorm: false,
		windsurf: false,
		cursor: false,
		sublime: false,
		zed: false,
		terminal: true,
		iterm: false,
		warp: false,
		ghostty: false,
	} ),
	isStudioCliInstalled: vi.fn().mockResolvedValue( true ),
	copyText: vi.fn().mockResolvedValue( undefined ),
	getDefaultSiteDirectory: vi.fn().mockResolvedValue( '/mock/default/site/path' ),
	getWapuuScore: vi.fn().mockResolvedValue( undefined ),
	getColorScheme: vi.fn().mockResolvedValue( 'light' ),
	saveColorScheme: vi.fn().mockResolvedValue( undefined ),
	getQuitSitesBehavior: vi.fn().mockResolvedValue( undefined ),
	saveQuitSitesBehavior: vi.fn().mockResolvedValue( undefined ),
	getGlobalAgentInstructions: vi.fn().mockResolvedValue( '' ),
	saveGlobalAgentInstructions: vi.fn().mockResolvedValue( undefined ),
};

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => mockIpcApi,
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
		vi.clearAllMocks();
		store.dispatch( installedAppsApi.util.resetApiState() );
		vi.mocked( useOffline ).mockReturnValue( false );
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
		await userEvent.click( screen.getByText( 'Account' ) );
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
		// Navigate to Account tab to find the logout button
		await userEvent.click( screen.getByText( 'Account' ) );
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
		// Navigate to Account tab
		await userEvent.click( screen.getByText( 'Account' ) );
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

			// General tab (renamed from Preferences) should be selected first
			await waitFor( () => {
				expect( screen.getByText( 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Terminal application' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio CLI for terminal' ) ).toBeInTheDocument();
			} );

			await user.click( screen.getByText( 'Account' ) );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Log out' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
				// Scoped to the panel: "Studio Code" also names a settings tab.
				expect(
					within( screen.getByRole( 'tabpanel' ) ).getByText( 'Studio Code' )
				).toBeInTheDocument();
				expect(
					screen.getByText( 'Studio Code limits are temporarily unavailable.' )
				).toBeInTheDocument();
				expect( screen.queryByText( /monthly prompts used/ ) ).not.toBeInTheDocument();
			} );

			await user.click( screen.getByRole( 'tab', { name: 'Studio Code' } ) );

			await waitFor( () => {
				expect( screen.getByRole( 'tab', { name: 'Studio Code' } ) ).toHaveAttribute(
					'aria-selected',
					'true'
				);
				expect( screen.getByLabelText( 'Instructions' ) ).toBeInTheDocument();
			} );
		} );
	} );

	it( 'saves the quit-sites behavior preference', async () => {
		const user = userEvent.setup();
		vi.mocked( useAuth ).mockReturnValue( {
			isAuthenticated: true,
			authenticate: vi.fn(),
			logout: vi.fn(),
			client: undefined,
		} );

		renderWithProvider( <UserSettings /> );

		const quitBehaviorSelect = await screen.findByTestId( 'quit-sites-behavior-select' );
		await user.selectOptions( quitBehaviorSelect, 'stop' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockIpcApi.saveQuitSitesBehavior ).toHaveBeenCalledWith( 'stop' );
	} );

	it( 'clears the quit-sites behavior preference when asking every time', async () => {
		const user = userEvent.setup();
		mockIpcApi.getQuitSitesBehavior.mockResolvedValueOnce( 'stop' );
		vi.mocked( useAuth ).mockReturnValue( {
			isAuthenticated: true,
			authenticate: vi.fn(),
			logout: vi.fn(),
			client: undefined,
		} );

		renderWithProvider( <UserSettings /> );

		const quitBehaviorSelect = await screen.findByTestId( 'quit-sites-behavior-select' );
		await waitFor( () => expect( quitBehaviorSelect ).toHaveValue( 'stop' ) );
		await user.selectOptions( quitBehaviorSelect, '' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );

		expect( mockIpcApi.saveQuitSitesBehavior ).toHaveBeenCalledWith( undefined );
	} );

	describe( 'Tab Selection via IPC', () => {
		it( 'should open with General tab when tabName is general', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'general' } ), 0 );
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
				expect( screen.getByText( 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
			} );
		} );

		it( 'should open with Account tab when tabName is account', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'account' } ), 0 );
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
				expect( screen.getByText( 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
			} );
		} );

		it( 'should show account tab for unauthenticated users with login button', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'account' } ), 0 );
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
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByRole( 'button', { name: 'Log in' } ) ).toBeInTheDocument();
			} );
		} );
	} );
} );
