import { reducer } from 'src/stores/new-sites-slice';

// Mock ipcListener
window.ipcListener = {
	subscribe: jest.fn(),
};

// Mock getIpcApi
jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn().mockReturnValue( {
		handleNewSite: jest.fn().mockResolvedValue( undefined ),
	} ),
} ) );

describe( 'newSitesSlice', () => {
	describe( 'reducers', () => {
		it( 'should set isProcessing when setIsProcessing action is dispatched', () => {
			const initialState = { isProcessing: false };

			const action = { type: 'newSites/setIsProcessing', payload: true };
			const nextState = reducer( initialState, action );

			expect( nextState.isProcessing ).toBe( true );
		} );

		it( 'should set isProcessing to true when handleNewSite.pending is dispatched', () => {
			const initialState = { isProcessing: false };

			const action = { type: 'newSites/handleNewSite/pending' };
			const nextState = reducer( initialState, action );

			expect( nextState.isProcessing ).toBe( true );
		} );

		it( 'should set isProcessing to false when handleNewSite.fulfilled is dispatched', () => {
			const initialState = { isProcessing: true };

			const action = { type: 'newSites/handleNewSite/fulfilled' };
			const nextState = reducer( initialState, action );

			expect( nextState.isProcessing ).toBe( false );
		} );

		it( 'should set isProcessing to false when handleNewSite.rejected is dispatched', () => {
			const initialState = { isProcessing: true };

			const action = { type: 'newSites/handleNewSite/rejected' };
			const nextState = reducer( initialState, action );

			expect( nextState.isProcessing ).toBe( false );
		} );
	} );
} );
