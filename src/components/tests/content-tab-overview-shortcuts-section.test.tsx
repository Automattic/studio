// To run tests, execute `npm run test -- src/components/tests/content-tab-overview-shortcuts-section.test.tsx` from the root directory
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useCheckInstalledApps } from '../../hooks/use-check-installed-apps';
import { useThemeDetails } from '../../hooks/use-theme-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import { ContentTabOverview } from '../content-tab-overview';

const selectedSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	id: 'site-id',
	url: 'http://example.com',
};

const mockGetIpcApi = getIpcApi as jest.Mock;
jest.mock( '../../hooks/use-check-installed-apps' );
jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-theme-details' );

describe( 'ShortcutsSection', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		( useThemeDetails as jest.Mock ).mockReturnValue( {
			isBlockTheme: true,
			supportsWidgets: false,
			supportsMenus: false,
		} );
	} );

	it( 'opens site in VS Code when VS Code is installed and the button is clicked', async () => {
		// Mock the `useCheckInstalledApps` hook to simulate VS Code being installed
		( useCheckInstalledApps as jest.Mock ).mockReturnValue( {
			vscode: true,
			phpstorm: false,
		} );

		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
		} );

		const { getByText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

		const vscodeButton = getByText( 'VS Code' );
		fireEvent.click( vscodeButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'vscode://' ) )
		);
	} );
	it( 'opens site in VS Code when VS Code and PhpStorm are both installed', async () => {
		// Mock the `useCheckInstalledApps` hook to simulate VS Code being installed
		( useCheckInstalledApps as jest.Mock ).mockReturnValue( {
			vscode: true,
			phpstorm: true,
		} );

		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
		} );

		const { getByText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

		const vscodeButton = getByText( 'VS Code' );
		fireEvent.click( vscodeButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'vscode://' ) )
		);
	} );

	it( 'opens site in PhpStorm when PhpStorm is installed and the button is clicked, only available on MacOS', async () => {
		// Mock the `useCheckInstalledApps` hook to simulate PhpStorm being installed
		( useCheckInstalledApps as jest.Mock ).mockReturnValue( {
			vscode: false,
			phpstorm: true,
		} );

		// Mock the IPC API
		const openURLMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openURL: openURLMock,
		} );

		const { getByText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

		const phpStormButton = getByText( 'PhpStorm' );
		fireEvent.click( phpStormButton );

		await waitFor( () =>
			expect( openURLMock ).toHaveBeenCalledWith( expect.stringContaining( 'phpstorm://' ) )
		);
	} );
	it( 'opens terminal when terminal is available and the button is clicked', async () => {
		// Mock the `useCheckInstalledApps` hook to simulate terminal being available
		( useCheckInstalledApps as jest.Mock ).mockReturnValue( {
			terminal: true,
			vscode: false,
			phpstorm: false,
		} );

		// Mock the IPC API
		const openTerminalAtPathMock = jest.fn();
		mockGetIpcApi.mockReturnValue( {
			openTerminalAtPath: openTerminalAtPathMock,
		} );

		// Render the component
		const { getByText } = render( <ContentTabOverview selectedSite={ selectedSite } /> );

		// Find the terminal button and click it
		const terminalButton = getByText( 'Terminal' );
		fireEvent.click( terminalButton );

		// Assert that the terminal was opened
		await waitFor( () => {
			expect( openTerminalAtPathMock ).toHaveBeenCalledWith( selectedSite.path );
		} );
	} );
} );
