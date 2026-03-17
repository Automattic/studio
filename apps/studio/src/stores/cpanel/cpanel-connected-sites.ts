import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { CpanelSyncSite } from 'src/modules/cpanel/types';

export const cpanelConnectedSitesApi = createApi( {
	reducerPath: 'cpanelConnectedSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'CpanelConnectedSites' ],
	endpoints: ( builder ) => ( {
		getCpanelSitesForLocalSite: builder.query< CpanelSyncSite[], { localSiteId?: string } >( {
			queryFn: async ( { localSiteId } ) => {
				if ( ! localSiteId ) {
					return { data: [] };
				}
				const sites = await getIpcApi().getConnectedCpanelSites( localSiteId );
				return { data: sites };
			},
			providesTags: ( result, error, arg ) => [
				{ type: 'CpanelConnectedSites', localSiteId: arg.localSiteId },
			],
		} ),

		connectCpanelSite: builder.mutation<
			CpanelSyncSite,
			Omit< CpanelSyncSite, 'id' | 'lastPullTimestamp' >
		>( {
			queryFn: async ( site ) => {
				const newSite = await getIpcApi().connectCpanelSite( site );
				return { data: newSite };
			},
			invalidatesTags: ( result, error, site ) => [
				{ type: 'CpanelConnectedSites', localSiteId: site.localSiteId },
			],
		} ),

		disconnectCpanelSite: builder.mutation< void, { cpanelSiteId: string; localSiteId: string } >( {
			queryFn: async ( { cpanelSiteId, localSiteId } ) => {
				await getIpcApi().disconnectCpanelSite( cpanelSiteId, localSiteId );
				return { data: undefined };
			},
			invalidatesTags: ( result, error, { localSiteId } ) => [
				{ type: 'CpanelConnectedSites', localSiteId },
			],
		} ),
	} ),
} );

export const {
	useGetCpanelSitesForLocalSiteQuery,
	useConnectCpanelSiteMutation,
	useDisconnectCpanelSiteMutation,
} = cpanelConnectedSitesApi;
