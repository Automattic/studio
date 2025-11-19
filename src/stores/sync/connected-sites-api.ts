import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

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

		updateSiteTimestamp: builder.mutation<
			void,
			{ siteId: number; localSiteId: string; type: 'pull' | 'push' }
		>( {
			queryFn: async ( { siteId, localSiteId, type } ) => {
				const sites = await getIpcApi().getConnectedWpcomSites( localSiteId );
				const site = sites.find(
					( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteId === siteLocalId
				);

				if ( ! site ) {
					return { error: { status: 'CUSTOM_ERROR', error: 'Site not found' } };
				}

				const updatedSite = {
					...site,
					[ type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp' ]: new Date().toISOString(),
				};

				await getIpcApi().updateSingleConnectedWpcomSite( updatedSite );

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
	useDisconnectSiteMutation,
	useUpdateSiteTimestampMutation,
} = connectedSitesApi;
