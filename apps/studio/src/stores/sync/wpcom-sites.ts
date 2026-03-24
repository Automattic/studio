import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { sitesEndpointSiteSchema, sitesEndpointResponseSchema } from '@studio/common/types/sync';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { reconcileConnectedSites } from 'src/modules/sync/lib/reconcile-connected-sites';
import { getSyncSupport, isPressableSite } from 'src/modules/sync/lib/sync-support';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { SitesEndpointSite, SyncSite, SyncSupport } from '@studio/common/types/sync';

export type { SitesEndpointSite } from '@studio/common/types/sync';

function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport,
	isStaging: boolean
): SyncSite {
	return {
		id: site.ID,
		localSiteId: '',
		name: site.name,
		url: site.URL,
		isStaging,
		isPressable: isPressableSite( site ),
		environmentType: site.environment_type,
		syncSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

/**
 * Transforms the WordPress.com sites API response into SyncSite objects.
 *
 * @param sites - Raw site data from the WordPress.com API
 * @param connectedSiteIds - Optional IDs of sites already connected to the current local site.
 *                           When provided, used to: 1) keep deleted sites in the list if they're connected, and
 *                           2) determine sync support status (already-connected vs syncable).
 *                           When not provided, no filtering based on connected sites is applied.
 */
function transformSitesResponse( sites: unknown[], connectedSiteIds?: number[] ): SyncSite[] {
	const validatedSites = sites.reduce< SitesEndpointSite[] >( ( acc, rawSite ) => {
		try {
			const site = sitesEndpointSiteSchema.parse( rawSite );
			return [ ...acc, site ];
		} catch ( error ) {
			Sentry.captureException( error );
			return acc;
		}
	}, [] );

	const allStagingSiteIds = validatedSites.flatMap( ( site ) => {
		return site.options?.wpcom_staging_blog_ids ?? [];
	} );

	return validatedSites
		.filter( ( site ) => ! site.is_a8c )
		.filter(
			// Filter out deleted sites, except if they're in the connectedSiteIds list
			( site ) =>
				! site.is_deleted ||
				( connectedSiteIds && connectedSiteIds.some( ( id ) => id === site.ID ) )
		)
		.map( ( site ) => {
			// The API returns the wrong value for the `is_wpcom_staging_site` prop while staging sites
			// are being created. Hence the check in other sites' `wpcom_staging_blog_ids` arrays.
			const isStaging = allStagingSiteIds.includes( site.ID );
			const syncSupport = getSyncSupport( site, connectedSiteIds ?? [] );

			return transformSingleSiteResponse( site, syncSupport, isStaging );
		} );
}

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

					const syncSitesForReconciliation = transformSitesResponse(
						parsedResponse.sites,
						allConnectedSites.map( ( { id } ) => id )
					);

					const { updatedConnectedSites } = reconcileConnectedSites(
						allConnectedSites,
						syncSitesForReconciliation
					);
					await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

					const syncSitesForSelectedSite = transformSitesResponse(
						parsedResponse.sites,
						connectedSiteIds
					);

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
