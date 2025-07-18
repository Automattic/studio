import { newSitesActions, reducer } from 'src/stores/new-sites-slice';

// Mock ipcListener
window.ipcListener = {
	subscribe: jest.fn(),
};

// Mock store
jest.mock( 'src/stores/index', () => ( {
	store: {
		getState: jest.fn(),
		dispatch: jest.fn(),
	},
} ) );

// Mock getIpcApi
jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn().mockReturnValue( {
		handleNewSite: jest.fn().mockResolvedValue( undefined ),
	} ),
} ) );

describe( 'newSitesSlice', () => {
	describe( 'reducers', () => {
		it( 'should add site IDs to processingSiteIds when addProcessingSites is dispatched', () => {
			const initialState = { processingSiteIds: [] };

			const action = newSitesActions.addProcessingSites( [ 'site-1', 'site-2' ] );
			const nextState = reducer( initialState, action );

			expect( nextState.processingSiteIds ).toEqual( [ 'site-1', 'site-2' ] );
		} );

		it( 'should deduplicate site IDs when adding to processingSiteIds', () => {
			const initialState = { processingSiteIds: [ 'site-1', 'site-3' ] };

			const action = newSitesActions.addProcessingSites( [ 'site-1', 'site-2' ] );
			const nextState = reducer( initialState, action );

			expect( nextState.processingSiteIds ).toEqual( [ 'site-1', 'site-3', 'site-2' ] );
		} );

		it( 'should remove site IDs from processingSiteIds when removeProcessingSites is dispatched', () => {
			const initialState = { processingSiteIds: [ 'site-1', 'site-2', 'site-3' ] };

			const action = newSitesActions.removeProcessingSites( [ 'site-1', 'site-3' ] );
			const nextState = reducer( initialState, action );

			expect( nextState.processingSiteIds ).toEqual( [ 'site-2' ] );
		} );

		it( 'should handle removing site IDs that do not exist in processingSiteIds', () => {
			const initialState = { processingSiteIds: [ 'site-1', 'site-2' ] };

			const action = newSitesActions.removeProcessingSites( [ 'site-3', 'site-4' ] );
			const nextState = reducer( initialState, action );

			expect( nextState.processingSiteIds ).toEqual( [ 'site-1', 'site-2' ] );
		} );
	} );
} );
