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
import type { ComponentType } from 'react';

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

const mockExtensionSettingsTabs = vi.hoisted( () => ( {
	value: [] as {
		name: string;
		title: string;
		component: ComponentType;
	}[],
} ) );
const mockExtensionAccountSections = vi.hoisted( () => ( {
	value: [] as {
		id: string;
		title: string;
		description: string;
		component: ComponentType;
	}[],
} ) );

vi.mock( 'src/extensions/hooks/use-studio-extension-settings', () => ( {
	useStudioExtensionSettingsTabs: () => mockExtensionSettingsTabs.value,
	useStudioExtensionAccountSections: () => mockExtensionAccountSections.value,
} ) );

const mockIpcApi = vi.hoisted( () => ( {
	getUserTerminal: vi.fn(),
	getUserEditor: vi.fn(),
	getInstalledAppsAndTerminals: vi.fn(),
	isStudioCliInstalled: vi.fn(),
	copyText: vi.fn(),
	getDefaultSiteDirectory: vi.fn(),
	getWapuuScore: vi.fn(),
	getColorScheme: vi.fn(),
	showOpenFolderDialog: vi.fn(),
	listStudioExtensions: vi.fn(),
	installStudioExtension: vi.fn(),
	installStudioExtensionFromPath: vi.fn(),
	installStudioExtensionFromUrl: vi.fn(),
	uninstallStudioExtension: vi.fn(),
	setStudioExtensionEnabled: vi.fn(),
	invokeStudioExtensionHandler: vi.fn(),
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

function SampleAccountConnection() {
	return <p>Sample account is connected.</p>;
}

function SampleDevelopmentSettings() {
	return <p>Sample extension development settings.</p>;
}

const sampleExtension = {
	id: 'sample-development-extension',
	name: 'Sample Development Extension',
	description: 'Adds sample extension development tools.',
	version: '0.1.0',
	kind: 'user' as const,
	installed: false,
	enabled: false,
	status: 'available' as const,
	isSupported: true,
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
		mockIpcApi.showOpenFolderDialog.mockResolvedValue( {
			path: '~/Code/sample-extension',
		} );
		mockIpcApi.listStudioExtensions.mockResolvedValue( [ sampleExtension ] );
		mockIpcApi.installStudioExtension.mockResolvedValue( {
			...sampleExtension,
			installed: true,
			enabled: true,
			status: 'installed',
		} );
		mockIpcApi.installStudioExtensionFromPath.mockResolvedValue( {
			...sampleExtension,
			installed: true,
			enabled: true,
			status: 'installed',
			sourceType: 'directory',
		} );
		mockIpcApi.installStudioExtensionFromUrl.mockResolvedValue( {
			...sampleExtension,
			installed: true,
			enabled: true,
			status: 'installed',
			sourceType: 'git',
			sourceUrl: 'https://github.com/example/sample-development-extension',
		} );
		mockIpcApi.uninstallStudioExtension.mockResolvedValue( sampleExtension );
		mockIpcApi.setStudioExtensionEnabled.mockResolvedValue( {
			...sampleExtension,
			installed: true,
			enabled: true,
			status: 'installed',
		} );
		mockIpcApi.invokeStudioExtensionHandler.mockResolvedValue( undefined );
		mockIpcApi.openURL.mockResolvedValue( undefined );
		mockExtensionSettingsTabs.value = [];
		mockExtensionAccountSections.value = [];
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
					'Extensions',
				] );
				expect( screen.getByText( 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Language' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Terminal application' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio CLI for terminal' ) ).toBeInTheDocument();
			} );

			await user.click( screen.getByRole( 'tab', { name: 'Extensions' } ) );

			await waitFor( () => {
				expect( screen.getByText( 'Extensions' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Sample Development Extension' ) ).toBeInTheDocument();
				expect( screen.getAllByRole( 'button', { name: 'Install' } ).length ).toBeGreaterThan( 0 );
			} );

			await user.click( screen.getByText( 'Account' ) );

			await waitFor( () => {
				expect( screen.getByText( 'Account' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'Log out' ) ).toBeInTheDocument();
				expect( screen.queryByText( 'Example Account' ) ).not.toBeInTheDocument();
				expect( screen.getByText( 'Preview sites' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Studio Code' ) ).toBeInTheDocument();
				expect(
					screen.getByText( 'Studio Code limits are temporarily unavailable.' )
				).toBeInTheDocument();
				expect( screen.queryByText( /monthly prompts used/ ) ).not.toBeInTheDocument();
			} );
		} );

		it( 'shows Accounts when an extension contributes an account section', async () => {
			const user = userEvent.setup();
			mockExtensionAccountSections.value = [
				{
					id: 'sample-account',
					title: 'Example Account',
					description: 'Used by the sample extension for publishing workflows.',
					component: SampleAccountConnection,
				},
			];
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
					'Extensions',
				] );
			} );

			await user.click( screen.getByRole( 'tab', { name: 'Accounts' } ) );

			await waitFor( () => {
				expect( screen.getByText( 'Accounts' ) ).toHaveAttribute( 'aria-selected', 'true' );
				expect( screen.getByText( 'WordPress.com' ) ).toBeInTheDocument();
				expect( screen.getByText( 'Example Account' ) ).toBeInTheDocument();
				expect(
					screen.getByText( 'Used by the sample extension for publishing workflows.' )
				).toBeInTheDocument();
				expect( screen.getByText( 'Sample account is connected.' ) ).toBeInTheDocument();
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

		it( 'should open with an extension settings tab when tabName matches it', async () => {
			mockExtensionSettingsTabs.value = [
				{
					name: 'development',
					title: 'Development',
					component: SampleDevelopmentSettings,
				},
			];
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
				expect( screen.getByText( 'Sample extension development settings.' ) ).toBeInTheDocument();
			} );
		} );

		it( 'installs an extension from the Extensions tab', async () => {
			const user = userEvent.setup();
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await user.click( screen.getByRole( 'tab', { name: 'Extensions' } ) );
			const installButtons = await screen.findAllByRole( 'button', { name: 'Install' } );

			await user.click( installButtons[ 1 ] );

			await waitFor( () => {
				expect( mockIpcApi.installStudioExtension ).toHaveBeenCalledWith(
					'sample-development-extension'
				);
			} );
		} );

		it( 'installs an extension from a Git URL', async () => {
			const user = userEvent.setup();
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await user.click( screen.getByRole( 'tab', { name: 'Extensions' } ) );
			await user.type(
				await screen.findByLabelText( 'Git URL' ),
				'https://github.com/example/sample-development-extension'
			);
			await user.click( screen.getAllByRole( 'button', { name: 'Install' } )[ 0 ] );

			await waitFor( () => {
				expect( mockIpcApi.installStudioExtensionFromUrl ).toHaveBeenCalledWith(
					'https://github.com/example/sample-development-extension'
				);
			} );
		} );

		it( 'installs an extension from a local directory', async () => {
			const user = userEvent.setup();
			vi.mocked( useAuth ).mockReturnValue( {
				isAuthenticated: true,
				authenticate: vi.fn(),
				logout: vi.fn(),
				client: undefined,
			} );

			renderWithProvider( <UserSettings /> );

			await user.click( screen.getByRole( 'tab', { name: 'Extensions' } ) );
			await user.click( await screen.findByRole( 'tab', { name: 'Local directory' } ) );
			await user.click(
				screen.getByRole( 'button', {
					name: 'Choose extension folder…, Select different local path',
				} )
			);
			await waitFor( () => {
				expect( mockIpcApi.showOpenFolderDialog ).toHaveBeenCalledWith(
					'Select extension folder',
					''
				);
				expect( screen.getByText( '~/Code/sample-extension' ) ).toBeInTheDocument();
			} );
			await user.click( screen.getAllByRole( 'button', { name: 'Install' } )[ 0 ] );

			await waitFor( () => {
				expect( mockIpcApi.installStudioExtensionFromPath ).toHaveBeenCalledWith(
					'~/Code/sample-extension'
				);
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
