import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { RootState } from 'src/stores';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';
import type { SyncSite, SyncModalMode } from 'src/modules/sync/types';

type ConnectedSitesState = {
	isModalOpen: boolean;
	modalMode: SyncModalMode | null;
	selectedRemoteSiteId: number | null;
};

function getInitialState(): ConnectedSitesState {
	return {
		isModalOpen: false,
		modalMode: null,
		selectedRemoteSiteId: null,
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

		closeModal: ( state ) => {
			state.isModalOpen = false;
			state.selectedRemoteSiteId = null;
		},

		setSelectedRemoteSiteId: ( state, action: PayloadAction< number > ) => {
			state.selectedRemoteSiteId = action.payload;
		},

		clearSelectedRemoteSiteId: ( state ) => {
			state.selectedRemoteSiteId = null;
		},
	},
} );

export const connectedSitesActions = connectedSitesSlice.actions;
export const connectedSitesReducer = connectedSitesSlice.reducer;
export const connectedSitesSelectors = {
	selectIsModalOpen: ( state: RootState ) => state.connectedSites.isModalOpen,
	selectModalMode: ( state: RootState ) => state.connectedSites.modalMode,
	selectSelectedRemoteSiteId: ( state: RootState ) => state.connectedSites.selectedRemoteSiteId,
};

async function persistConnectedSite( site: SyncSite, localSiteId: string ) {
	await getIpcApi().connectWpcomSites( [
		{
			sites: [ site ],
			localSiteId,
		},
	] );

	return getIpcApi().getConnectedWpcomSites( localSiteId );
}

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
				const actualConnectedSites = await persistConnectedSite( site, localSiteId );
				return { data: actualConnectedSites };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'ConnectedSites', localSiteId },
			],
		} ),

		connectSiteById: builder.mutation<
			SyncSite[],
			{ remoteSiteId: number; localSiteId: string; userId?: number }
		>( {
			queryFn: async ( { remoteSiteId, localSiteId, userId }, api ) => {
				const connectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
				const { data: remoteSites = [] } = await api.dispatch(
					wpcomSitesApi.endpoints.getWpComSites.initiate(
						{
							connectedSiteIds: connectedSites.map( ( site ) => site.id ),
							userId,
						},
						{ forceRefetch: true }
					)
				);
				const siteToConnect = remoteSites.find( ( site ) => site.id === remoteSiteId );

				if ( ! siteToConnect ) {
					return {
						error: {
							status: 'CUSTOM_ERROR',
							error: 'Site not found in WordPress.com sites',
						},
					};
				}

				const actualConnectedSites = await persistConnectedSite( siteToConnect, localSiteId );
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

		updateSiteTimestamp: builder.mutation<
			void,
			{ siteId: number; localSiteId: string; type: 'pull' | 'push' }
		>( {
			queryFn: async ( { siteId, localSiteId, type } ) => {
				const connectedSites = await getIpcApi().getConnectedWpcomSites( localSiteId );
				const connectedSite = connectedSites.find(
					( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteId === siteLocalId
				);

				if ( ! connectedSite ) {
					return { error: { status: 'CUSTOM_ERROR', error: 'Site not found' } };
				}

				const timestampKey = type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp';
				const updatedConnectedSite = {
					...connectedSite,
					[ timestampKey ]: new Date().toISOString(),
				};

				await getIpcApi().updateSingleConnectedWpcomSite( updatedConnectedSite );

				return { data: undefined };
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
	useConnectSiteByIdMutation,
	useDisconnectSiteMutation,
	useUpdateSiteTimestampMutation,
} = connectedSitesApi;
