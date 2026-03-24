import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import {
	transformSingleSiteResponse,
	transformSitesResponse,
} from '@studio/common/lib/sync/transform-sites';
import { sitesEndpointSiteSchema, sitesEndpointResponseSchema } from '@studio/common/types/sync';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { reconcileConnectedSites } from 'src/modules/sync/lib/reconcile-connected-sites';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { SyncSite } from '@studio/common/types/sync';

export type { SitesEndpointSite } from '@studio/common/types/sync';

const SITE_FIELDS = [
	'name',
	'ID',
	'URL',
	'plan',
	'capabilities',
	'is_wpcom_atomic',
	'options',
	'jetpack',
	'is_deleted',
	'is_a8c',
	'hosting_provider_guess',
	'environment_type',
].join( ',' );

export const wpcomSitesApi = createApi( {
	reducerPath: 'wpcomSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'WpComSites' ],
	endpoints: ( builder ) => ( {
		getSingleWpComSite: builder.query< SyncSite, { siteId: number; userId?: number } >( {
			queryFn: async ( { siteId } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const response = await wpcomClient.req.get(
						{
							apiNamespace: 'rest/v1.1',
							path: `/sites/${ siteId }`,
						},
						{
							fields: SITE_FIELDS,
							options: 'created_at,wpcom_staging_blog_ids',
						}
					);

					const parsedSite = sitesEndpointSiteSchema.parse( response );

					const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

					// Determine if staging by checking environment_type (can't access parent site's staging IDs without fetching /me/sites)
					const isStaging =
						parsedSite.environment_type === 'staging' ||
						parsedSite.environment_type === 'development';

					const syncSupport = getSyncSupport(
						parsedSite,
						allConnectedSites.map( ( { id } ) => id )
					);

					const syncSite = transformSingleSiteResponse( parsedSite, syncSupport, isStaging );

					return { data: syncSite };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			providesTags: ( _result, _error, arg ) => [
				{ type: 'WpComSites', userId: arg.userId },
				{ type: 'WpComSites', id: arg.siteId },
			],
		} ),
		getWpComSites: builder.query< SyncSite[], { connectedSiteIds?: number[]; userId?: number } >( {
			queryFn: async ( { connectedSiteIds } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

					const response = await wpcomClient.req.get(
						{
							apiNamespace: 'rest/v1.2',
							path: `/me/sites`,
						},
						{
							fields: SITE_FIELDS,
							filter: 'atomic,wpcom',
							options: 'created_at,wpcom_staging_blog_ids',
							site_activity: 'active',
						}
					);

					const parsedResponse = sitesEndpointResponseSchema.parse( response );

					const sentryOptions = { onParseError: Sentry.captureException };

					const syncSitesForReconciliation = transformSitesResponse( parsedResponse.sites, {
						connectedSiteIds: allConnectedSites.map( ( { id } ) => id ),
						...sentryOptions,
					} );

					const { updatedConnectedSites } = reconcileConnectedSites(
						allConnectedSites,
						syncSitesForReconciliation
					);
					await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

					const syncSitesForSelectedSite = transformSitesResponse( parsedResponse.sites, {
						connectedSiteIds,
						...sentryOptions,
					} );

					return { data: syncSitesForSelectedSite };
				} catch ( error ) {
					Sentry.captureException( error );
					console.error( error );
					return {
						error: {
							status: 500,
							data: error,
						},
					};
				}
			},
			providesTags: ( _result, _error, arg ) => [ { type: 'WpComSites', userId: arg.userId } ],
		} ),
	} ),
} );

const { useGetWpComSitesQuery: useGetWpComSitesQueryBase } = wpcomSitesApi;

// Wrap the query hook with offline check
// Authentication is already handled in queryFn which checks wpcomClient
export const useGetWpComSitesQuery = withOfflineCheck( useGetWpComSitesQueryBase );
