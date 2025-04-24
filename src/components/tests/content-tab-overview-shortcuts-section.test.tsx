// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { reducer as installedAppsReducer } from 'src/stores/installed-apps-slice';

const selectedSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.0',
	id: 'site-id',
	url: 'http://example.com',
};

const mockGetIpcApi = getIpcApi as jest.Mock;
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( 'src/hooks/use-theme-details' );
jest.mock( 'src/hooks/use-feature-flags' );

describe( 'ShortcutsSection', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( useThemeDetails as jest.Mock ).mockReturnValue( {
			selectedThemeDetails: {
				isBlockTheme: true,
				supportsWidgets: false,
				supportsMenus: false,
			},
		} );
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			terminalWpCliEnabled: false,
		} );
	} );

	it( 'opens site in VS Code when the user select VS Code and clicked the button', async () => {
		// Create a test store with VS Code installed
		const testStore = configureStore( {
			reducer: {
				installedApps: installedAppsReducer,
			},
			preloadedState: {
				installedApps: {
					vscode: true,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					iterm: false,
				},
			},
		} );

		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		// Render the component with the Redux Provider
		const { getByText } = render(
			<Provider store={ testStore }>
				<ContentTabOverview selectedSite={ selectedSite } />
			</Provider>
		);

		// Find and click the VS Code button
		const vscodeButton = await waitFor( () => getByText( 'VS Code' ) );
		fireEvent.click( vscodeButton );

		// Verify that openURL was called with the correct path
		await waitFor( () => {
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( '/path/to/site' ) );
		} );
	} );

	it( 'opens site in PhpStorm when PhpStorm is installed and the button is clicked, only available on MacOS', async () => {
		// Create a test store with PhpStorm installed
		const testStore = configureStore( {
			reducer: {
				installedApps: installedAppsReducer,
			},
			preloadedState: {
				installedApps: {
					vscode: false,
					phpstorm: true,
					webstorm: false,
					windsurf: false,
					cursor: false,
					iterm: false,
				},
			},
		} );

		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'phpstorm' ), // User prefers PhpStorm
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		const { getByLabelText } = render(
			<Provider store={ testStore }>
				<ContentTabOverview selectedSite={ selectedSite } />
			</Provider>
		);

		// Wait for component to finish rendering and async operations to complete
		const phpStormButton = await waitFor( () => getByLabelText( 'PhpStorm' ) );
		fireEvent.click( phpStormButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'phpstorm://' ) )
		);
	} );

	it( 'opens terminal when terminal is available and the button is clicked', async () => {
		// Create a test store with no editors installed
		const testStore = configureStore( {
			reducer: {
				installedApps: installedAppsReducer,
			},
			preloadedState: {
				installedApps: {
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					iterm: false,
				},
			},
		} );

		// Mock the IPC API
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		const { getByLabelText } = render(
			<Provider store={ testStore }>
				<ContentTabOverview selectedSite={ selectedSite } />
			</Provider>
		);

		// Wait for component to finish rendering and async operations to complete
		const terminalButton = await waitFor( () => getByLabelText( 'Terminal' ) );
		fireEvent.click( terminalButton );

		// Assert that the terminal was opened
		await waitFor( () => {
			expect( openTerminalAtPathMock ).toHaveBeenCalledWith( selectedSite.path, {
				wpCliEnabled: false,
			} );
		} );
	} );

	it( 'opens terminal with wp-cli integration if feature flag is enabled', async () => {
		// Create a test store with no editors installed
		const testStore = configureStore( {
			reducer: {
				installedApps: installedAppsReducer,
			},
			preloadedState: {
				installedApps: {
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					iterm: false,
				},
			},
		} );

		// Mock the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			terminalWpCliEnabled: true,
		} );

		// Mock the IPC API
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		const { getByLabelText } = render(
			<Provider store={ testStore }>
				<ContentTabOverview selectedSite={ selectedSite } />
			</Provider>
		);

		const terminalButton = await waitFor( () => getByLabelText( 'Terminal' ) );
		fireEvent.click( terminalButton );

		// Assert that the terminal was opened
		await waitFor( () => {
			expect( openTerminalAtPathMock ).toHaveBeenCalledWith( selectedSite.path, {
				wpCliEnabled: true,
			} );
		} );
	} );

	it( 'does not show editor buttons when no editors are installed', async () => {
		// Create a test store with no editors installed
		const testStore = configureStore( {
			reducer: {
				installedApps: installedAppsReducer,
			},
			preloadedState: {
				installedApps: {
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					iterm: false,
				},
			},
		} );

		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		const { queryByLabelText, findByLabelText } = render(
			<Provider store={ testStore }>
				<ContentTabOverview selectedSite={ selectedSite } />
			</Provider>
		);

		await findByLabelText( 'Terminal' );
		expect( queryByLabelText( 'VS Code' ) ).toBeNull();
		expect( queryByLabelText( 'PhpStorm' ) ).toBeNull();
	} );
} );
