import { Reducer, UnknownAction } from '@reduxjs/toolkit';
import { QueryStatus } from '@reduxjs/toolkit/query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { produce } from 'immer';
import { Provider } from 'react-redux';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { RootState, store } from 'src/stores';
import { InstalledAppsState } from 'src/stores/installed-apps-api';
import { testReducer } from 'src/stores/tests/utils/test-reducer';

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

describe( 'TerminalPicker', () => {
	const mockOnChange = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
		store.dispatch( { type: 'test/resetState' } );
		mockGetIpcApi.mockReturnValue( {
			getInstalledAppsAndTerminals: jest.fn().mockResolvedValue( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: true,
				warp: false,
				ghostty: false,
			} ),
		} );
	} );

	it( 'renders correctly with initial props', async () => {
		// Set up mock data for installed terminals
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				terminal: true,
				iterm: true,
				warp: false,
				ghostty: false,
			} )
		);

		renderWithProvider( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		// Wait for the component to render with the mocked data
		await waitFor( () => {
			expect( screen.getByText( 'Shell' ) ).toBeVisible();
			expect( screen.getByRole( 'combobox' ) ).toBeVisible();
		} );
	} );

	it( 'calls onChange when selecting a different terminal', async () => {
		// Set up mock data for installed terminals
		store.dispatch(
			installedAppsTestActions.setInstalledApps( {
				// Editor properties
				vscode: false,
				phpstorm: false,
				webstorm: false,
				windsurf: false,
				cursor: false,
				// Terminal properties
				terminal: true,
				iterm: true,
				warp: false,
				ghostty: false,
			} )
		);

		renderWithProvider( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		const select = await waitFor( () => screen.getByRole( 'combobox' ) );
		fireEvent.change( select, { target: { value: 'iterm' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'iterm' );
	} );
} );
