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

const mockIpcApi = vi.hoisted( () => ( {
	getUserTerminal: vi.fn(),
	getUserEditor: vi.fn(),
	getInstalledAppsAndTerminals: vi.fn(),
	isStudioCliInstalled: vi.fn(),
	copyText: vi.fn(),
	getDefaultSiteDirectory: vi.fn(),
	getWapuuScore: vi.fn(),
	getColorScheme: vi.fn(),
	getPluginDevelopmentEnabled: vi.fn(),
	savePluginDevelopmentEnabled: vi.fn(),
	getWordPressOrgAccount: vi.fn(),
	loginToWordPressOrg: vi.fn(),
	logoutFromWordPressOrg: vi.fn(),
	openURL: vi.fn(),
} ) );

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
		vi.mocked( useAuth ).mockReset();
		vi.mocked( useIpcListener ).mockReset();
		vi.mocked( useOffline ).mockReset();
		store.dispatch( installedAppsApi.util.resetApiState() );
		mockIpcApi.getUserTerminal.mockResolvedValue( 'terminal' );
		mockIpcApi.getUserEditor.mockResolvedValue( 'vscode' );
		mockIpcApi.getInstalledAppsAndTerminals.mockResolvedValue( {
			terminals: [ 'terminal' ],
			editors: [ 'vscode' ],
		} );
		mockIpcApi.isStudioCliInstalled.mockResolvedValue( true );
		mockIpcApi.copyText.mockResolvedValue( undefined );
		mockIpcApi.getDefaultSiteDirectory.mockResolvedValue( '/mock/default/site/path' );
		mockIpcApi.getWapuuScore.mockResolvedValue( undefined );
		mockIpcApi.getColorScheme.mockResolvedValue( 'light' );
		mockIpcApi.getPluginDevelopmentEnabled.mockResolvedValue( false );
		mockIpcApi.savePluginDevelopmentEnabled.mockResolvedValue( undefined );
		mockIpcApi.getWordPressOrgAccount.mockResolvedValue( undefined );
		mockIpcApi.loginToWordPressOrg.mockResolvedValue( {
			username: 'pressship-user',
			profileUrl: 'https://profiles.wordpress.org/pressship-user/',
		} );
		mockIpcApi.logoutFromWordPressOrg.mockResolvedValue( undefined );
		mockIpcApi.openURL.mockResolvedValue( undefined );
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
				expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
					'General',
					'Account',
					'Skills',
					'MCP',
					'Development',
				] );
				expect( screen.getByText( 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Terminal application' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio CLI for terminal' ) ).toBeInTheDocument();
			} );

			await user.click( screen.getByRole( 'tab', { name: 'Development' } ) );

			await waitFor( () => {
				expect( screen.getByText( 'Development' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect(
					screen.getByRole( 'checkbox', {
						name: 'Enable Plugin Development and Publishing',
					} )
				).toBeInTheDocument();
			} );

			await user.click( screen.getByText( 'Account' ) );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Log out' ) ).toBeInTheDocument();
				expect( screen.queryByText( 'WordPress.org' ) ).not.toBeInTheDocument();
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio Code' ) ).toBeInTheDocument();
				expect(
					screen.getByText( 'Generous token limits while Studio Code is in beta.' )
				).toBeInTheDocument();
				expect( screen.queryByText( /monthly prompts used/ ) ).not.toBeInTheDocument();
			} );
		} );

		it( 'shows Accounts with WordPress.org when plugin development is enabled', async () => {
			const user = userEvent.setup();
			mockIpcApi.getPluginDevelopmentEnabled.mockResolvedValue( true );
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await waitFor( () => {
				expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
					'General',
					'Accounts',
					'Skills',
					'MCP',
					'Development',
				] );
			} );

			await user.click( screen.getByRole( 'tab', { name: 'Accounts' } ) );

			await waitFor( () => {
				expect( screen.getByText( 'Accounts' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'WordPress.com' ) ).toBeInTheDocument();
				expect( screen.getByText( 'WordPress.org' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Not connected' ) ).toBeInTheDocument();
				expect(
					screen.getByText(
						'WordPress.org uses a separate account for plugin and theme submissions, review state, and SVN releases.'
					)
				).toBeInTheDocument();
			} );

			const loginButton = await screen.findByRole( 'button', { name: 'Log in' } );
			await waitFor( () => {
				expect( loginButton ).toBeEnabled();
			} );
			await user.click( loginButton );

			expect( mockIpcApi.loginToWordPressOrg ).toHaveBeenCalled();

			await waitFor( () => {
				expect( screen.getByText( 'pressship-user' ) ).toBeInTheDocument();
				expect( screen.getAllByRole( 'button', { name: 'Log out' } ) ).toHaveLength( 2 );
			} );
		} );
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

		it( 'should open with Development tab when tabName is development', async () => {
			vi.mocked( useIpcListener ).mockImplementation( ( listener, callback ) => {
				if ( listener === 'user-settings' ) {
					setTimeout( () => callback( mockIpcEvent, { tabName: 'development' } ), 0 );
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
				expect( screen.getByText( 'Development' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect(
					screen.getByText(
						'Show plugin development tools in the Studio sidebar so you can add local plugin projects, inspect release metadata, and prepare publishing workflows from Studio.'
					)
				).toBeInTheDocument();
			} );
		} );

		it( 'saves the plugin development preference when the checkbox changes', async () => {
			const user = userEvent.setup();
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await user.click( screen.getByRole( 'tab', { name: 'Development' } ) );
			const checkbox = await screen.findByRole( 'checkbox', {
				name: 'Enable Plugin Development and Publishing',
			} );

			expect( checkbox ).not.toBeChecked();
			await user.click( checkbox );

			await waitFor( () => {
				expect( mockIpcApi.savePluginDevelopmentEnabled ).toHaveBeenCalledWith( true );
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
