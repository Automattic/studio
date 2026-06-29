// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabsProvider } from 'src/hooks/use-content-tabs';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { isMac } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

vi.mock( 'src/lib/app-globals', () => ( {
	isWindows: vi.fn().mockReturnValue( false ),
	isLinux: vi.fn().mockReturnValue( false ),
	isMac: vi.fn().mockReturnValue( false ),
	getAppGlobals: vi.fn( () => ( {
		platform: 'darwin',
	} ) ),
} ) );
vi.mock( 'src/lib/file-manager', () => ( {
	getFileManagerLabel: vi.fn().mockReturnValue( 'Finder' ),
} ) );

const selectedSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	phpVersion: '8.4',
	id: 'site-id',
	url: 'http://example.com',
};

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-theme-details' );
vi.mock( 'src/stores/sync', async () => ( {
	...( await vi.importActual( 'src/stores/sync' ) ),
	useConnectedSitesData: vi.fn().mockReturnValue( {
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
		vi.clearAllMocks();
		vi.mocked( useThemeDetails, { partial: true } ).mockReturnValue( {
			selectedThemeDetails: {
				name: 'Test Theme',
				path: '/path/to/theme',
				slug: 'test-theme',
				isBlockTheme: true,
				supportsWidgets: false,
				supportsMenus: false,
			},
		} );

		// Reset the store state before each test
		store.dispatch( { type: 'test/resetState' } );
	} );

	it( 'opens site in Visual Studio Code when the user select Visual Studio Code and clicked the button', async () => {
		// Mock the IPC API with getInstalledApps returning the installed apps
		const openURLMock = vi.fn();
		const openAppAtPathMock = vi.fn();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openURL: openURLMock,
			openAppAtPath: openAppAtPathMock,
			getUserEditor: vi.fn().mockResolvedValue( 'vscode' ),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
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

		// Find and click the Visual Studio Code button
		const vscodeButton = await waitFor( () => getByText( 'Visual Studio Code' ) );
		fireEvent.click( vscodeButton );

		// Verify that openURL was called with the correct path
		await waitFor( () => {
			expect( openAppAtPathMock ).toHaveBeenCalledWith( 'vscode', selectedSite.path );
		} );
	} );

	it( 'opens site in PhpStorm when PhpStorm is installed and the button is clicked, only available on MacOS', async () => {
		vi.mocked( isMac ).mockReturnValue( true );

		// Mock the IPC API with getInstalledApps returning the installed apps
		const openAppAtPathMock = vi.fn();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openAppAtPath: openAppAtPathMock,
			getUserEditor: vi.fn().mockResolvedValue( 'phpstorm' ), // User prefers PhpStorm
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
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
		const openTerminalAtPathMock = vi.fn();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: vi.fn().mockResolvedValue( null ),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
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
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			openLocalPath: vi.fn(),
			getUserEditor: vi.fn().mockResolvedValue( 'cursor' ),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
		} );

		const { queryByLabelText, findByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		await findByLabelText( 'Cursor' );

		expect( queryByLabelText( 'Visual Studio Code' ) ).not.toBeInTheDocument();
		expect( queryByLabelText( 'PhpStorm' ) ).not.toBeInTheDocument();
	} );

	it( 'hides phpMyAdmin for MySQL sites', async () => {
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			getUserEditor: vi.fn().mockResolvedValue( null ),
			getUserTerminal: vi.fn().mockResolvedValue( 'terminal' ),
			getInstalledAppsAndTerminals: vi.fn().mockResolvedValue( {
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

		const { findByLabelText, queryByLabelText } = renderWithProvider(
			<ContentTabOverview selectedSite={ { ...selectedSite, databaseEngine: 'mysql' } } />
		);

		await findByLabelText( 'Terminal' );

		expect( queryByLabelText( 'phpMyAdmin' ) ).not.toBeInTheDocument();
	} );
} );
