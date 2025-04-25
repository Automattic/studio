import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores/index';

interface NewSitesState {
	processingSiteIds: string[];
}

const initialState: NewSitesState = {
	processingSiteIds: [],
};

const newSitesSlice = createSlice( {
	name: 'newSites',
	initialState,
	reducers: {
		addProcessingSites: ( state, action: PayloadAction< string[] > ) => {
			state.processingSiteIds = [ ...new Set( [ ...state.processingSiteIds, ...action.payload ] ) ];
		},
		removeProcessingSites: ( state, action: PayloadAction< string[] > ) => {
			state.processingSiteIds = state.processingSiteIds.filter(
				( id ) => ! action.payload.includes( id )
			);
		},
	},
} );

export const { addProcessingSites, removeProcessingSites } = newSitesSlice.actions;

const handleNewSite = createAsyncThunk(
	'newSites/handleNewSite',
	async ( sites: NewSiteDetails[], { dispatch } ) => {
		const siteIds = sites.map( ( site ) => site.id );
		dispatch( addProcessingSites( siteIds ) );

		try {
			await Promise.all(
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
		} finally {
			dispatch( removeProcessingSites( siteIds ) );
		}
	}
);

window.ipcListener.subscribe( 'user-data-updated', ( _, payload ) => {
	const state = store.getState();
	const newSites = payload.newSites;

	if ( newSites?.length ) {
		const sitesToProcess = newSites.filter(
			( site ) => ! state.newSites.processingSiteIds.includes( site.id )
		);

		if ( sitesToProcess.length ) {
			void store.dispatch( handleNewSite( sitesToProcess ) );
		}
	}
} );

export const { reducer } = newSitesSlice;
