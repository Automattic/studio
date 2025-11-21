// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { isMac } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

jest.mock( 'src/lib/app-globals', () => ( {
	isWindows: jest.fn().mockReturnValue( false ),
	isMac: jest.fn().mockReturnValue( false ),
} ) );

const selectedSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.3',
	id: 'site-id',
	url: 'http://example.com',
};

const mockGetIpcApi = getIpcApi as jest.Mock;
jest.mock( 'src/lib/get-ipc-api' );
jest.mock( 'src/hooks/use-theme-details' );
jest.mock( 'src/stores/sync', () => ( {
	...jest.requireActual( 'src/stores/sync' ),
	useConnectedSitesData: jest.fn().mockReturnValue( {
		connectedSites: [],
		localSiteId: 'site-id',
	} ),
} ) );

// Replace the store's reducer with our test reducer
store.replaceReducer( testReducer );

function renderWithProvider( component: React.ReactElement ) {
	return render(
		<Provider store={ store }>
			<ContentTabsProvider>{ component }</ContentTabsProvider>
		</Provider>
	);
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

		// Reset the store state before each test
		store.dispatch( { type: 'test/resetState' } );
	} );

	it( 'opens site in VS Code when the user select VS Code and clicked the button', async () => {
		// Mock the IPC API with getInstalledApps returning the installed apps
		const openURLMock = jest.fn();
		const openAppAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			openAppAtPath: openAppAtPathMock,
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
			expect( openAppAtPathMock ).toHaveBeenCalledWith( 'vscode', selectedSite.path );
		} );
	} );

	it( 'opens site in PhpStorm when PhpStorm is installed and the button is clicked, only available on MacOS', async () => {
		( isMac as jest.Mock ).mockReturnValue( true );

		// Mock the IPC API with getInstalledApps returning the installed apps
		const openAppAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openAppAtPath: openAppAtPathMock,
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
			expect( openAppAtPathMock ).toHaveBeenCalledWith( 'phpstorm', '/path/to/site' )
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
			expect( openTerminalAtPathMock ).toHaveBeenCalledWith( selectedSite.path );
		} );
	} );

	it( 'shows users preferred editor', async () => {
		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( 'cursor' ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
		} );

		const { queryByLabelText, findByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		await findByLabelText( 'Cursor' );

		expect( queryByLabelText( 'VS Code' ) ).not.toBeInTheDocument();
		expect( queryByLabelText( 'PhpStorm' ) ).not.toBeInTheDocument();
	} );
} );
