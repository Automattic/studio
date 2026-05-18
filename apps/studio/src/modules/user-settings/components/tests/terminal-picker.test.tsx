import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { store } from 'src/stores';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

const mockGetInstalledAppsAndTerminals = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getInstalledAppsAndTerminals: mockGetInstalledAppsAndTerminals,
	} ),
} ) );

vi.mock( 'src/lib/app-globals', () => ( {
	getAppGlobals: vi.fn( () => ( {
		platform: 'darwin',
	} ) ),
	isWindows: vi.fn( () => false ),
	isLinux: vi.fn( () => false ),
} ) );

store.replaceReducer( testReducer );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

describe( 'TerminalPicker', () => {
	const mockOnChange = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( { type: 'test/resetState' } );
		mockGetInstalledAppsAndTerminals.mockResolvedValue( {
			vscode: false,
			phpstorm: false,
			webstorm: false,
			windsurf: false,
			cursor: false,
			terminal: true,
			iterm: true,
			warp: false,
			ghostty: false,
		} );
	} );

	it( 'renders correctly with initial props', async () => {
		// Set up mock data for installed terminals
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, () => {
				return {
					antigravity: false,
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					sublime: false,
					zed: false,
					terminal: true,
					iterm: true,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		// Wait for the component to render with the mocked data
		await waitFor( () => {
			expect( screen.getByText( 'Terminal application' ) ).toBeVisible();
			expect( screen.getByRole( 'combobox' ) ).toBeVisible();
		} );
	} );

	it( 'calls onChange when selecting a different terminal', async () => {
		// Set up mock data for installed terminals
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, () => {
				return {
					// Editor properties
					antigravity: false,
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					sublime: false,
					zed: false,
					// Terminal properties
					terminal: true,
					iterm: true,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		const select = await waitFor( () => screen.getByRole( 'combobox' ) );
		fireEvent.change( select, { target: { value: 'iterm' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'iterm' );
	} );
} );
