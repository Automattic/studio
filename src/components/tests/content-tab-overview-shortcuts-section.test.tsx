// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { fireEvent, render, waitFor } from '@testing-library/react';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

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
jest.mock( 'src/hooks/use-check-installed-apps' );
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
		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'vscode' ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [ 'terminal' ] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: true,
				phpstorm: false,
			} ),
		} );

		const { getByLabelText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );
		const vscodeButton = await waitFor( () => getByLabelText( 'VS Code' ) );
		fireEvent.click( vscodeButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'vscode://' ) )
		);
	} );

	it( 'opens site in PhpStorm when PhpStorm is installed and the button is clicked, only available on MacOS', async () => {
		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
			getUserEditor: jest.fn().mockResolvedValue( 'phpstorm' ), // User prefers PhpStorm
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [ 'terminal' ] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: true,
			} ),
		} );

		const { getByLabelText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

		// Wait for component to finish rendering and async operations to complete
		const phpStormButton = await waitFor( () => getByLabelText( 'PhpStorm' ) );
		fireEvent.click( phpStormButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'phpstorm://' ) )
		);
	} );
	it( 'opens terminal when terminal is available and the button is clicked', async () => {
		// Mock the IPC API
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [ 'terminal' ] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
			} ),
		} );

		const { getByLabelText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

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
		( useFeatureFlags as jest.Mock ).mockReturnValue( {
			terminalWpCliEnabled: true,
		} );

		// Mock the IPC API
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( 'terminal' ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [ 'terminal' ] ),
		} );

		const { getByLabelText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

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
		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( null ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
			} ),
		} );

		const { queryByLabelText, findByLabelText } = render(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );

		expect( queryByLabelText( 'VS Code' ) ).toBeNull();
		expect( queryByLabelText( 'PhpStorm' ) ).toBeNull();
	} );

	it( 'shows VS Code editor button when VS Code and phpStorm both editors are installed', async () => {
		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( null ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: true,
				phpstorm: true,
			} ),
		} );

		const { queryByLabelText, findByLabelText } = render(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		await findByLabelText( 'VS Code' );

		expect( queryByLabelText( 'PhpStorm' ) ).toBeNull();
	} );

	it( 'shows phpStorm editor button when VS Code is not installed but phpStorm is', async () => {
		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( null ),
			getUserTerminal: jest.fn().mockResolvedValue( null ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: true,
			} ),
		} );

		const { queryByLabelText, findByLabelText } = render(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		await findByLabelText( 'PhpStorm' );

		expect( queryByLabelText( 'VS Code' ) ).toBeNull();
	} );

	it( 'shows users preferred editor', async () => {
		// Mock the IPC API
		mockGetIpcApi.mockReturnValue( {
			openLocalPath: jest.fn(),
			getUserEditor: jest.fn().mockResolvedValue( 'cursor' ),
			getUserTerminal: jest.fn().mockResolvedValue( null ),
			getInstalledTerminals: jest.fn().mockResolvedValue( [] ),
			getInstalledApps: jest.fn().mockResolvedValue( {
				vscode: true,
				phpstorm: true,
				cursor: true,
			} ),
		} );

		const { queryByLabelText, findByLabelText } = render(
			<ContentTabOverview selectedSite={ selectedSite } />
		);

		await findByLabelText( 'Terminal' );
		await findByLabelText( 'Cursor' );

		expect( queryByLabelText( 'VS Code' ) ).toBeNull();
		expect( queryByLabelText( 'PhpStorm' ) ).toBeNull();
	} );
} );
