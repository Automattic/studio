import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import type { SlotType } from 'src/modules/sync/lib/environment-utils';
import type { SyncSite, SyncModalMode } from 'src/modules/sync/types';

type ConnectedSitesState = {
	isModalOpen: boolean;
	modalMode: SyncModalMode | null;
	connectingSlot: SlotType | null;
	selectedRemoteSiteId: number | null;
	selectedLocalSiteId: string | null;
	loadingSiteIds: Record< number, boolean >;
};

function getInitialState(): ConnectedSitesState {
	return {
		isModalOpen: false,
		modalMode: null,
		connectingSlot: null,
		selectedRemoteSiteId: null,
		selectedLocalSiteId: null,
		loadingSiteIds: {},
	};
}

const connectedSitesSlice = createSlice( {
	name: 'connectedSites',
	initialState: getInitialState(),
	reducers: {
		openModal: ( state, action: PayloadAction< SyncModalMode | undefined > ) => {
			state.isModalOpen = true;
			if ( action.payload ) {
				state.modalMode = action.payload;
			}
		},

		openModalForSlot: (
			state,
			action: PayloadAction< { mode: SyncModalMode; slot: SlotType } >
		) => {
			state.isModalOpen = true;
			state.modalMode = action.payload.mode;
			state.connectingSlot = action.payload.slot;
		},

		closeModal: ( state ) => {
			state.isModalOpen = false;
			state.connectingSlot = null;
			state.selectedRemoteSiteId = null;
			state.selectedLocalSiteId = null;
		},

		setSelectedRemoteSiteId: (
			state,
			action: PayloadAction< { remoteSiteId: number; localSiteId: string } >
		) => {
			state.selectedRemoteSiteId = action.payload.remoteSiteId;
			state.selectedLocalSiteId = action.payload.localSiteId;
		},

		clearSelectedRemoteSiteId: ( state ) => {
			state.selectedRemoteSiteId = null;
			state.selectedLocalSiteId = null;
		},

		addLoadingSiteId: ( state, action: PayloadAction< number > ) => {
			state.loadingSiteIds[ action.payload ] = true;
		},

		removeLoadingSiteId: ( state, action: PayloadAction< number > ) => {
			delete state.loadingSiteIds[ action.payload ];
		},
	},
} );

export const connectedSitesActions = connectedSitesSlice.actions;
export const connectedSitesReducer = connectedSitesSlice.reducer;
export const connectedSitesSelectors = {
	selectIsModalOpen: ( state: RootState ) => state.connectedSites.isModalOpen,
	selectModalMode: ( state: RootState ) => state.connectedSites.modalMode,
	selectSelectedRemoteSiteId: ( state: RootState ) => state.connectedSites.selectedRemoteSiteId,
	selectSelectedLocalSiteId: ( state: RootState ) => state.connectedSites.selectedLocalSiteId,
	selectConnectingSlot: ( state: RootState ) => state.connectedSites.connectingSlot,
	selectIsLoadingSiteId: ( id: number ) => ( state: RootState ) =>
		Boolean( state.connectedSites.loadingSiteIds[ id ] ),
};

export const connectedSitesApi = createApi( {
	reducerPath: 'connectedSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'ConnectedSites' ],
	endpoints: ( builder ) => ( {
		getConnectedSitesForLocalSite: builder.query<
			SyncSite[],
			{ localSiteId?: string; userId?: number }
		>( {
			queryFn: async ( { localSiteId } ) => {
				if ( ! localSiteId ) {
					return { data: [] };
				}

				const sites = await getIpcApi().getConnectedWpcomSites( localSiteId );
				return { data: sites };
			},
			providesTags: ( result, error, arg ) => [
				{ type: 'ConnectedSites', localSiteId: arg.localSiteId, userId: arg.userId },
			],
		} ),

		connectSite: builder.mutation< SyncSite[], { site: SyncSite; localSiteId: string } >( {
			queryFn: async ( { site, localSiteId } ) => {
				await getIpcApi().connectWpcomSites( [
					{
						sites: [ site ],
						localSiteId,
					},
				] );

				const actualConnectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );

				return { data: actualConnectedSites };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'ConnectedSites', localSiteId },
			],
		} ),

		disconnectSite: builder.mutation< SyncSite[], { siteId: number; localSiteId: string } >( {
			queryFn: async ( { siteId, localSiteId } ) => {
				await getIpcApi().disconnectWpcomSites( [
					{
						siteIds: [ siteId ],
						localSiteId,
					},
				] );

				const actualConnectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );

				return { data: actualConnectedSites };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'ConnectedSites', localSiteId },
			],
		} ),
	} ),
} );

export const {
	useGetConnectedSitesForLocalSiteQuery,
	useConnectSiteMutation,
	useDisconnectSiteMutation,
} = connectedSitesApi;
