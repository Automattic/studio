import { Reducer, UnknownAction } from '@reduxjs/toolkit';
import { QueryStatus } from '@reduxjs/toolkit/query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores';
import { InstalledAppsState } from 'src/stores/installed-apps-api';
import { testReducer } from 'src/stores/tests/utils/test-reducer';
import { EditorPicker } from '../editor-picker';

jest.mock( 'src/lib/get-ipc-api' );
const mockGetIpcApi = getIpcApi as jest.Mock;

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
		} );
	} );

	it( 'renders select control with no editors installed', async () => {
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: false,
				iterm: false,
				warp: false,
				ghostty: false,
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		await waitFor( () => {
			expect( screen.getByRole( 'combobox' ) ).toBeDisabled();
			expect( screen.getByText( 'No supported editors found' ) ).toBeInTheDocument();
		} );
	} );

	it( 'renders select control with installed editors', async () => {
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				vscode: true,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: false,
				iterm: false,
				warp: false,
				ghostty: false,
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
			expect( notInstalledGroup ).toHaveTextContent( 'WindSurf' );
			expect( notInstalledGroup ).toHaveTextContent( 'Cursor' );
		} );
	} );

	it( 'handles editor selection change', async () => {
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				vscode: true,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: false,
				iterm: false,
				warp: false,
				ghostty: false,
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = await waitFor( () => screen.getByRole( 'combobox' ) );
		fireEvent.change( select, { target: { value: 'vscode' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'vscode' );
	} );

	it( 'disables uninstalled editors in the select', async () => {
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				vscode: true,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: false,
				iterm: false,
				warp: false,
				ghostty: false,
			} )
		);

		renderWithProvider( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = await waitFor( () => screen.getByRole( 'combobox' ) );
		const options = select.querySelectorAll( 'option' );
		// First option should be enabled (Select)
		expect( options[ 0 ] ).not.toBeDisabled();
		// Second option should be enabled (VS Code)
		expect( options[ 1 ] ).not.toBeDisabled();
		// Third option should be disabled (PhpStorm)
		expect( options[ 2 ] ).toBeDisabled();
	} );
} );
