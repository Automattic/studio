import { createAsyncThunk, createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit';
import fastDeepEqual from 'fast-deep-equal';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState, store } from 'src/stores';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import type { SyncModalMode } from 'src/modules/sync/types';

type ConnectedSites = SyncSite[];
type ModalState = false | true | { disconnectSiteId?: number };

interface ConnectedSitesState {
	sites: Record< string, ConnectedSites >; // Keyed by localSiteId for efficient lookups
	isModalOpen: ModalState;
	modalMode: SyncModalMode | null;
}

interface ConnectSiteParams {
	site: SyncSite;
	localSiteId: string;
}

interface DisconnectSiteParams {
	siteId: number;
	localSiteId: string;
}

const initialState: ConnectedSitesState = {
	sites: {},
	isModalOpen: false,
	modalMode: null,
};

export const loadAllConnectedSites = createAsyncThunk( 'connectedSites/loadAll', async () => {
	const allSites = await getIpcApi().getConnectedWpcomSites();

	const sitesByLocalSiteId: Record< string, ConnectedSites > = {};
	allSites.forEach( ( site ) => {
		if ( ! sitesByLocalSiteId[ site.localSiteId ] ) {
			sitesByLocalSiteId[ site.localSiteId ] = [];
		}
		sitesByLocalSiteId[ site.localSiteId ].push( site );
	} );

	return sitesByLocalSiteId;
} );

export const connectSite = createAsyncThunk(
	'connectedSites/connect',
	async ( { site, localSiteId }: ConnectSiteParams ) => {
		await getIpcApi().connectWpcomSites( [
			{
				sites: [ site ],
				localSiteId,
			},
		] );

		const actualConnectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );

		return {
			localSiteId,
			connectedSites: actualConnectedSites,
		};
	}
);

export const disconnectSite = createAsyncThunk(
	'connectedSites/disconnect',
	async ( { siteId, localSiteId }: DisconnectSiteParams ) => {
		await getIpcApi().disconnectWpcomSites( [
			{
				siteIds: [ siteId ],
				localSiteId,
			},
		] );

		const actualConnectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );

		return {
			localSiteId,
			connectedSites: actualConnectedSites,
		};
	}
);

const connectedSitesSlice = createSlice( {
	name: 'connectedSites',
	initialState,
	reducers: {
		updateSite: ( state, action: PayloadAction< { localSiteId: string; site: SyncSite } > ) => {
			const { localSiteId, site } = action.payload;
			const sites = state.sites[ localSiteId ] || [];
			const index = sites.findIndex( ( s ) => s.id === site.id );

			if ( index !== -1 ) {
				sites[ index ] = site;
			}
		},

		clearSitesForLocalSite: ( state, action: PayloadAction< string > ) => {
			delete state.sites[ action.payload ];
		},

		openModal: ( state, action: PayloadAction< SyncModalMode | undefined > ) => {
			state.isModalOpen = true;
			if ( action.payload ) {
				state.modalMode = action.payload;
			}
		},

		setModalMode: ( state, action: PayloadAction< SyncModalMode | null > ) => {
			state.modalMode = action.payload;
		},

		closeModal: ( state ) => {
			state.isModalOpen = false;
		},
	},
	extraReducers: ( builder ) => {
		builder
			.addCase( loadAllConnectedSites.fulfilled, ( state, action ) => {
				state.sites = action.payload;
			} )
			.addCase( connectSite.fulfilled, ( state, action ) => {
				const { localSiteId, connectedSites } = action.payload;
				state.sites[ localSiteId ] = connectedSites;
			} )
			.addCase( disconnectSite.fulfilled, ( state, action ) => {
				const { localSiteId, connectedSites } = action.payload;
				state.sites[ localSiteId ] = connectedSites;
			} );
	},
} );

export const connectedSitesActions = connectedSitesSlice.actions;
export const connectedSitesReducer = connectedSitesSlice.reducer;

export const connectedSitesSelectors = {
	selectIsModalOpen: ( state: RootState ) => state.connectedSites.isModalOpen,
	selectModalMode: ( state: RootState ) => state.connectedSites.modalMode,
	selectSitesByLocalSiteId: createSelector(
		[
			( state: RootState ) => state.connectedSites,
			( _: RootState, localSiteId: string | undefined ) => localSiteId,
		],
		( connectedSitesState, localSiteId ) =>
			localSiteId ? connectedSitesState.sites[ localSiteId ] || [] : []
	),
};

window.ipcListener.subscribe( 'user-data-updated', async ( _, userData ) => {
	const state = store.getState();
	const currentUserId = userData.authToken?.id;

	if ( ! currentUserId ) {
		return;
	}

	const connectedSitesFromUserData = userData.connectedWpcomSites?.[ currentUserId ] || [];
	const connectedSitesFromState = Object.values( state.connectedSites.sites ).flat();

	if ( ! fastDeepEqual( connectedSitesFromUserData, connectedSitesFromState ) ) {
		void store.dispatch( loadAllConnectedSites() );
	}
} );
