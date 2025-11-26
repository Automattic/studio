import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import * as Sentry from '@sentry/electron/renderer';
import { z } from 'zod';
import { reconcileConnectedSites } from 'src/hooks/use-fetch-wpcom-sites/reconcile-connected-sites';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { withOfflineCheck } from 'src/stores/utils/with-offline-check';
import { getWpcomClient } from 'src/stores/wpcom-api';
import type { SyncSite, SyncSupport } from 'src/hooks/use-fetch-wpcom-sites/types';

// Schema for WordPress.com sites endpoint
const sitesEndpointSiteSchema = z.object( {
	ID: z.number(),
	is_wpcom_atomic: z.boolean(),
	name: z.string(),
	URL: z.string(),
	jetpack: z.boolean().optional(),
	is_deleted: z.boolean(),
	hosting_provider_guess: z.string().optional(),
	environment_type: z
		.enum( [ 'production', 'staging', 'development', 'sandbox', 'local' ] )
		.nullable()
		.optional(),
	is_a8c: z.boolean().optional(),
	options: z
		.object( {
			created_at: z.string(),
			wpcom_staging_blog_ids: z.array( z.number() ),
		} )
		.optional(),
	capabilities: z
		.object( {
			manage_options: z.boolean(),
		} )
		.optional(),
	plan: z
		.object( {
			expired: z.boolean().optional(),
			features: z.object( {
				active: z.array( z.string() ),
				available: z.record( z.string(), z.array( z.string() ) ).optional(),
			} ),
			is_free: z.boolean().optional(),
			product_id: z.coerce.number(),
			product_name_short: z.string(),
			product_slug: z.string(),
			user_is_owner: z.boolean().optional(),
		} )
		.optional(),
} );

type SitesEndpointSite = z.infer< typeof sitesEndpointSiteSchema >;

// We use a permissive schema for the API response to fail gracefully if a single site is malformed
const sitesEndpointResponseSchema = z.object( {
	sites: z.array( z.unknown() ),
} );

const STUDIO_SYNC_FEATURE_NAME = 'studio-sync';

function isPressableSite( site: SitesEndpointSite ): boolean {
	return site.hosting_provider_guess === 'pressable';
}

function isAtomicSite( site: SitesEndpointSite ): boolean {
	return site.is_wpcom_atomic;
}

function hasSupportedPlan( site: SitesEndpointSite ): boolean {
	return site.plan?.features.active.includes( STUDIO_SYNC_FEATURE_NAME ) ?? false;
}

function isJetpackSite( site: SitesEndpointSite ): boolean {
	return !! site.jetpack && ! isAtomicSite( site ) && ! isPressableSite( site );
}

function needsTransfer( site: SitesEndpointSite ): boolean {
	return ! isJetpackSite( site ) && ! isPressableSite( site ) && ! isAtomicSite( site );
}

function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
	if ( site.is_deleted ) {
		return 'deleted';
	}
	if ( ! site.capabilities?.manage_options ) {
		return 'missing-permissions';
	}
	if ( isJetpackSite( site ) ) {
		return 'unsupported';
	}
	if ( ! hasSupportedPlan( site ) && ! isPressableSite( site ) ) {
		return 'needs-upgrade';
	}
	if ( needsTransfer( site ) ) {
		return 'needs-transfer';
	}
	if ( connectedSiteIds.some( ( id ) => id === site.ID ) ) {
		return 'already-connected';
	}
	return 'syncable';
}

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

function transformSitesResponse( sites: unknown[], connectedSiteIds: number[] ): SyncSite[] {
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
		.filter( ( site ) => ! site.is_deleted || connectedSiteIds.some( ( id ) => id === site.ID ) )
		.map( ( site ) => {
			// The API returns the wrong value for the `is_wpcom_staging_site` prop while staging sites
			// are being created. Hence the check in other sites' `wpcom_staging_blog_ids` arrays.
			const isStaging = allStagingSiteIds.includes( site.ID );
			const syncSupport = getSyncSupport( site, connectedSiteIds );

			return transformSingleSiteResponse( site, syncSupport, isStaging );
		} );
}

export const wpcomSitesApi = createApi( {
	reducerPath: 'wpcomSitesApi',
	baseQuery: fetchBaseQuery(),
	tagTypes: [ 'WpComSites' ],
	endpoints: ( builder ) => ( {
		getWpComSites: builder.query< SyncSite[], { connectedSiteIds: number[]; userId?: number } >( {
			queryFn: async ( { connectedSiteIds } ) => {
				const wpcomClient = getWpcomClient();
				if ( ! wpcomClient ) {
					return { error: { status: 401, data: 'Not authenticated' } };
				}

				try {
					const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

					const fields = [
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

					const response = await wpcomClient.req.get(
						{
							apiNamespace: 'rest/v1.2',
							path: `/me/sites`,
						},
						{
							fields,
							filter: 'atomic,wpcom',
							options: 'created_at,wpcom_staging_blog_ids',
							site_activity: 'active',
						}
					);

					const parsedResponse = sitesEndpointResponseSchema.parse( response );

					// First transformation using all connected sites (for reconciliation)
					const syncSitesForReconciliation = transformSitesResponse(
						parsedResponse.sites,
						allConnectedSites.map( ( { id } ) => id )
					);

					// whenever array of syncSites changes, we need to update connectedSites to keep them updated with wordpress.com
					const { updatedConnectedSites } = reconcileConnectedSites(
						allConnectedSites,
						syncSitesForReconciliation
					);
					await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

					// Second transformation using connectedSiteIds parameter (for syncSupport calculation for selected site)
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
			providesTags: ( result, error, arg ) => [ { type: 'WpComSites', userId: arg.userId } ],
			keepUnusedDataFor: 60,
		} ),
	} ),
} );

const { useGetWpComSitesQuery: useGetWpComSitesQueryBase } = wpcomSitesApi;

// Wrap the query hook with offline check
// Authentication is already handled in queryFn which checks wpcomClient
export const useGetWpComSitesQuery = withOfflineCheck( useGetWpComSitesQueryBase );
