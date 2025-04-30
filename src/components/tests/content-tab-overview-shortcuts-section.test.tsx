// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { Reducer, UnknownAction } from '@reduxjs/toolkit';
import { QueryStatus } from '@reduxjs/toolkit/query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { getInstalledAppsAndTerminals } from 'src/ipc-handlers';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores';
import { InstalledAppsState } from 'src/stores/installed-apps-api';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

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

// Create a test reducer for installedAppsApi
function installedAppsTestReducer( state: RootState, action: UnknownAction ) {
	if ( action.type === 'installedApps/setInstalledApps' ) {
		const payload = action.payload as {
			installedApps: InstalledAppsState;
		};

		return produce( state!, ( draftState ) => {
			if ( draftState ) {
				// Set the query result in the RTK Query cache
				draftState.installedAppsApi.queries = {
					'getInstalledApps({"forceRefetch":false})': {
						status: QueryStatus.fulfilled,
						data: payload.installedApps,
						error: undefined,
						requestId: 'test-request-id',
						endpointName: 'getInstalledApps',
						startedTimeStamp: 0,
						fulfilledTimeStamp: 0,
						originalArgs: undefined as never,
					},
				};
			}
		} );
	}

	return testReducer( state, action );
}

// Create test actions for installedAppsApi
const installedAppsTestActions = {
	setInstalledApps: ( installedApps: InstalledAppsState ) => {
		return { type: 'installedApps/setInstalledApps', payload: { installedApps } };
	},
};

// Replace the store's reducer with our test reducer
store.replaceReducer( installedAppsTestReducer as Reducer< RootState > );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

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

		// Reset the store state before each test
		store.dispatch( { type: 'test/resetState' } );
	} );

	it( 'opens site in VS Code when the user select VS Code and clicked the button', async () => {
		// Mock the IPC API with getInstalledApps returning the installed apps
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: true,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: false,
				ghostty: false,
				warp: false,
			} ),
		} );

		// Render the component with the Redux Provider
		const { getByText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
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
		// Mock the IPC API with getInstalledApps returning the installed apps
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'phpstorm' ), // User prefers PhpStorm
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: true,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: false,
				ghostty: false,
				warp: false,
			} ),
		} );

		const { getByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		// Wait for component to finish rendering and async operations to complete
		const phpStormButton = await waitFor( () => getByLabelText( 'PhpStorm' ) );
		fireEvent.click( phpStormButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'phpstorm://' ) )
		);
	} );

	it( 'opens terminal when terminal is available and the button is clicked', async () => {
		// Mock the IPC API with getInstalledApps returning the installed apps
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: false,
				ghostty: false,
				warp: false,
			} ),
		} );

		const { getByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
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
		// Mock the feature flag
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			terminalWpCliEnabled: true,
		} );

		// Mock the IPC API with getInstalledApps returning the installed apps
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: false,
				ghostty: false,
				warp: false,
			} ),
		} );

		const { getByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
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
		// Mock the IPC API with getInstalledApps returning the installed apps
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: false,
				ghostty: false,
				warp: false,
			} ),
		} );

		const { queryByLabelText, findByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		expect( queryByLabelText( 'VS Code' ) ).toBeNull();
		expect( queryByLabelText( 'PhpStorm' ) ).toBeNull();
	} );
} );
