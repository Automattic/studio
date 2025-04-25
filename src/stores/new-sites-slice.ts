import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores/index';

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
	extraReducers: ( builder ) => {
		builder
			.addCase( handleNewSite.pending, ( state ) => {
				state.isProcessing = true;
			} )
			.addCase( handleNewSite.fulfilled, ( state ) => {
				state.isProcessing = false;
			} )
			.addCase( handleNewSite.rejected, ( state ) => {
				state.isProcessing = false;
			} );
	},
} );

const handleNewSite = createAsyncThunk( 'newSites/handleNewSite', ( sites: NewSiteDetails[] ) => {
	return Promise.all(
		sites.map( async ( site ) => {
			try {
				await getIpcApi().handleNewSite( site );
			} catch ( error ) {
				console.error(
					`[New Sites Slice] Failed to create site for folder: ${ site.path }`,
					error
				);
			}
		} )
	);
} );

window.ipcListener.subscribe( 'user-data-updated', ( _, payload ) => {
	const state = store.getState();
	const newSites = payload.newSites;

	if ( ! state.newSites.isProcessing && newSites ) {
		store.dispatch( handleNewSite( newSites ) );
	}
} );

export const { reducer } = newSitesSlice;
