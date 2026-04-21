import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type {
	StagingSite,
	SyncState,
	ValidateQuotaResponse,
} from '@studio/common/types/staging-site';
import type { SyncOption } from '@studio/common/types/sync';

export const stagingSiteApi = createApi( {
	reducerPath: 'stagingSiteApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'StagingSite', 'StagingSyncState' ],
	endpoints: ( builder ) => ( {
		listStagingSites: builder.query< StagingSite[], { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().listStagingSites( args ) } ),
			providesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		createStagingSite: builder.mutation< StagingSite, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().createStagingSite( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		deleteStagingSite: builder.mutation<
			void,
			{ productionSiteId: number; stagingSiteId: number }
		>( {
			queryFn: async ( args ) => {
				await getIpcApi().deleteStagingSite( args );
				return { data: undefined };
			},
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSite', id: productionSiteId },
			],
		} ),
		validateStagingQuota: builder.mutation< ValidateQuotaResponse, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().validateStagingQuota( args ) } ),
		} ),
		pushToStaging: builder.mutation<
			unknown,
			{ productionSiteId: number; stagingSiteId: number; options: SyncOption[] }
		>( {
			queryFn: async ( args ) => ( { data: await getIpcApi().pushToStaging( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
		pullFromStaging: builder.mutation<
			unknown,
			{
				productionSiteId: number;
				stagingSiteId: number;
				options: SyncOption[];
				allowWooSync: boolean;
			}
		>( {
			queryFn: async ( args ) => ( { data: await getIpcApi().pullFromStaging( args ) } ),
			invalidatesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
		getStagingSyncState: builder.query< SyncState | null, { productionSiteId: number } >( {
			queryFn: async ( args ) => ( { data: await getIpcApi().getStagingSyncState( args ) } ),
			providesTags: ( _r, _e, { productionSiteId } ) => [
				{ type: 'StagingSyncState', id: productionSiteId },
			],
		} ),
	} ),
} );

export const {
	useListStagingSitesQuery,
	useCreateStagingSiteMutation,
	useDeleteStagingSiteMutation,
	useValidateStagingQuotaMutation,
	usePushToStagingMutation,
	usePullFromStagingMutation,
	useGetStagingSyncStateQuery,
	useLazyListStagingSitesQuery,
} = stagingSiteApi;
