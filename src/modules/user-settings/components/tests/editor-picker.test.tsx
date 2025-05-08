import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { store } from 'src/stores';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

jest.mock( 'src/lib/get-ipc-api' );
const mockGetIpcApi = getIpcApi as jest.Mock;

store.replaceReducer( testReducer );

function renderWithProvider( component: React.ReactElement ) {
	return render( <Provider store={ store }>{ component }</Provider> );
}

describe( 'EditorPicker', () => {
	const mockOnChange = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
		store.dispatch( { type: 'test/resetState' } );
		mockGetIpcApi.mockReturnValue( {
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: true,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: false,
				iterm: false,
				warp: false,
				ghostty: false,
			} ),
			getUserEditor: jest.fn().mockResolvedValue( undefined ),
			openURL: jest.fn(),
		} );
	} );

	it( 'renders select control with no editors installed', async () => {
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, ( data ) => {
				return {
					vscode: false,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					terminal: false,
					iterm: false,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'combobox' ) ).not.toBeDisabled();
			expect( screen.getByText( 'Select' ) ).toBeInTheDocument();
		} );
	} );

	it( 'renders select control with installed editors', async () => {
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, ( data ) => {
				return {
					vscode: true,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					terminal: false,
					iterm: false,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		await waitFor( () => {
			const select = screen.getByRole( 'combobox' );
			expect( select ).not.toBeDisabled();
			expect( screen.getByText( 'Select' ) ).toBeInTheDocument();
			expect( screen.getByText( 'VS Code' ) ).toBeInTheDocument();

			const notInstalledGroup = select.querySelector( 'optgroup[label="Not installed"]' );
			expect( notInstalledGroup ).toBeInTheDocument();
			expect( notInstalledGroup ).toHaveTextContent( 'PhpStorm' );
			expect( notInstalledGroup ).toHaveTextContent( 'WebStorm' );
			expect( notInstalledGroup ).toHaveTextContent( 'Windsurf' );
			expect( notInstalledGroup ).toHaveTextContent( 'Cursor' );
		} );
	} );

	it( 'handles editor selection change', async () => {
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, ( data ) => {
				return {
					vscode: true,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					terminal: false,
					iterm: false,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = await waitFor( () => screen.getByRole( 'combobox' ) );
		fireEvent.change( select, { target: { value: 'vscode' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'vscode' );
	} );

	it( 'disables uninstalled editors in the select', async () => {
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, ( data ) => {
				return {
					vscode: true,
					phpstorm: false,
					webstorm: false,
					windsurf: false,
					cursor: false,
					terminal: false,
					iterm: false,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		await waitFor( () => {
			const select = screen.getByRole( 'combobox' );
			expect( select ).not.toBeDisabled();
			const options = select.querySelectorAll( 'option' );
			expect( options[ 0 ] ).not.toBeDisabled();
			expect( options[ 1 ] ).not.toBeDisabled();
			expect( options[ 2 ] ).toBeDisabled();
			expect( options[ 3 ] ).toBeDisabled();
			expect( options[ 4 ] ).toBeDisabled();
			expect( options[ 5 ] ).toBeDisabled();
		} );
	} );

	it( 'selects user preferred editor', async () => {
		store.dispatch(
			installedAppsApi.util.updateQueryData( 'getInstalledApps', undefined, ( data ) => {
				return {
					vscode: true,
					phpstorm: true,
					webstorm: true,
					windsurf: false,
					cursor: false,
					terminal: false,
					iterm: false,
					warp: false,
					ghostty: false,
				};
			} )
		);

		renderWithProvider( <EditorPicker value={ 'phpstorm' } onChange={ mockOnChange } /> );

		// check if phpstorm option selected
		const select = screen.getByRole( 'combobox' );
		expect( select ).toHaveValue( 'phpstorm' );
	} );
} );
