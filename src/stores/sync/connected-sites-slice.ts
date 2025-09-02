import { createAsyncThunk, createSelector, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

type ConnectedSites = SyncSite[];
type ModalState = false | true | { disconnectSiteId?: number };

interface ConnectedSitesState {
	sites: Record< string, ConnectedSites >; // Keyed by localSiteId for efficient lookups
	isModalOpen: ModalState;
}

interface ConnectSiteParams {
	site: SyncSite;
	stagingSites: SyncSite[];
	localSiteId: string;
}

interface DisconnectSiteParams {
	siteId: number;
	stagingSiteIds: number[];
	localSiteId: string;
}

const initialState: ConnectedSitesState = {
	sites: {},
	isModalOpen: false,
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
	async ( { site, stagingSites, localSiteId }: ConnectSiteParams ) => {
		const sitesToConnect = [ site, ...stagingSites ];

		await getIpcApi().connectWpcomSites( [
			{
				sites: sitesToConnect,
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
	async ( { siteId, stagingSiteIds, localSiteId }: DisconnectSiteParams ) => {
		const sitesToDisconnect = [ siteId, ...stagingSiteIds ];

		await getIpcApi().disconnectWpcomSites( [
			{
				siteIds: sitesToDisconnect,
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

		openModal: ( state ) => {
			state.isModalOpen = true;
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
	selectSitesByLocalSiteId: createSelector(
		[
			( state: RootState ) => state.connectedSites,
			( _: RootState, localSiteId: string | undefined ) => localSiteId,
		],
		( connectedSitesState, localSiteId ) =>
			localSiteId ? connectedSitesState.sites[ localSiteId ] || [] : []
	),
};
