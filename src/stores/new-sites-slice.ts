import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores/index';

interface NewSitesState {
	isProcessing: boolean;
}

const initialState: NewSitesState = {
	isProcessing: false,
};

const newSitesSlice = createSlice( {
	name: 'newSites',
	initialState,
	reducers: {
		setIsProcessing: ( state, action: PayloadAction< boolean > ) => {
			state.isProcessing = action.payload;
		},
	},
} );

window.ipcListener.subscribe( 'user-data-updated', ( _, payload ) => {
	const state = store.getState() as RootState & { newSites?: NewSitesState };

	const newSites = payload.newSites;

	if ( ! state.newSites?.isProcessing && newSites && newSites.length > 0 ) {
		store.dispatch( newSitesSlice.actions.setIsProcessing( true ) );

		Promise.all(
			newSites.map( async ( site: NewSiteDetails ) => {
				try {
					await getIpcApi().handleNewSite( site );
				} catch ( error ) {
					console.error(
						`[New Sites Slice] Failed to create site for folder: ${ site.path }`,
						error
					);
				}
			} )
		).finally( () => {
			store.dispatch( newSitesSlice.actions.setIsProcessing( false ) );
		} );
	}
} );

export const { reducer } = newSitesSlice;
