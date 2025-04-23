import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { z } from 'zod';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { reconcileConnectedSites } from 'src/hooks/use-fetch-wpcom-sites/reconcile-connected-sites';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncSite, SyncSupport } from 'src/hooks/use-fetch-wpcom-sites/types';

export const sitesEndpointSiteSchema = z.object( {
	ID: z.number(),
	is_wpcom_atomic: z.boolean(),
	name: z.string(),
	URL: z.string(),
	jetpack: z.boolean().optional(),
	is_deleted: z.boolean(),
	hosting_provider_guess: z.string().optional(),
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
			expired: z.boolean(),
			features: z.object( {
				active: z.array( z.string() ),
				available: z.record( z.string(), z.array( z.string() ) ).optional(),
			} ),
			is_free: z.boolean(),
			product_id: z.number(),
			product_name_short: z.string(),
			product_slug: z.string(),
			user_is_owner: z.boolean(),
		} )
		.optional(),
} );

type SitesEndpointSite = z.infer< typeof sitesEndpointSiteSchema >;

// We use a permissive schema for the API response to fail gracefully if a single site is malformed
export const sitesEndpointResponseSchema = z.object( {
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

export function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
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

export function transformSingleSiteResponse(
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
		stagingSiteIds: site.options?.wpcom_staging_blog_ids ?? [],
		syncSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

export function transformSitesResponse( sites: unknown[], connectedSiteIds: number[] ): SyncSite[] {
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
		.filter( ( site ) => ! site.is_deleted || connectedSiteIds.some( ( id ) => id === site.ID ) )
		.map( ( site ) => {
			// The API returns the wrong value for the `is_wpcom_staging_site` prop while staging sites
			// are being created. Hence the check in other sites' `wpcom_staging_blog_ids` arrays.
			const isStaging = allStagingSiteIds.includes( site.ID );
			const syncSupport = getSyncSupport( site, connectedSiteIds );

			return transformSingleSiteResponse( site, syncSupport, isStaging );
		} );
}

export type FetchSites = () => Promise< SyncSite[] >;

export const useFetchWpComSites = ( connectedSiteIdsOnlyForSelectedSite: number[] ) => {
	const [ rawSyncSites, setRawSyncSites ] = useState< unknown[] >( [] );
	const { isAuthenticated, client } = useAuth();
	const isFetchingSites = useRef( false );
	const isOffline = useOffline();
	const { pressableSyncEnabled } = useFeatureFlags();

	const joinedConnectedSiteIds = connectedSiteIdsOnlyForSelectedSite.join( ',' );
	// we need this trick to avoid unnecessary re-renders,
	// as a result different instances of the same array don't trigger refetching
	const memoizedConnectedSiteIds: number[] = useMemo(
		() =>
			joinedConnectedSiteIds
				? joinedConnectedSiteIds.split( ',' ).map( ( id ) => parseInt( id, 10 ) )
				: [],
		[ joinedConnectedSiteIds ]
	);

	const fetchSites = useCallback< FetchSites >( async () => {
		if ( ! client?.req || isFetchingSites.current || ! isAuthenticated || isOffline ) {
			return [];
		}

		isFetchingSites.current = true;

		try {
			const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

			const baseFields = 'name,ID,URL,plan,capabilities,is_wpcom_atomic,options,jetpack,is_deleted';
			const fields = pressableSyncEnabled ? `${ baseFields },hosting_provider_guess` : baseFields;

			const response = await client.req.get(
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
			const syncSites = transformSitesResponse(
				parsedResponse.sites,
				allConnectedSites.map( ( { id } ) => id )
			);

			// whenever array of syncSites changes, we need to update connectedSites to keep them updated with wordpress.com
			const { updatedConnectedSites, stagingSitesToAdd, stagingSitesToDelete } =
				reconcileConnectedSites( allConnectedSites, syncSites );

			await getIpcApi().updateConnectedWpcomSites( updatedConnectedSites );

			if ( stagingSitesToDelete.length ) {
				const data = stagingSitesToDelete.map( ( { id, localSiteId } ) => ( {
					siteIds: [ id ],
					localSiteId,
				} ) );

				await getIpcApi().disconnectWpcomSites( data );
			}

			if ( stagingSitesToAdd.length ) {
				const data = stagingSitesToAdd.map( ( site ) => ( {
					sites: [ site ],
					localSiteId: site.localSiteId,
				} ) );

				await getIpcApi().connectWpcomSites( data );
			}

			setRawSyncSites( parsedResponse.sites );

			return syncSites;
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
			return [];
		} finally {
			isFetchingSites.current = false;
		}
	}, [ client?.req, isAuthenticated, isOffline, pressableSyncEnabled ] );

	useEffect( () => {
		fetchSites();
	}, [ fetchSites ] );

	const syncSitesWithSyncSupportForSelectedSite = useMemo(
		() => transformSitesResponse( rawSyncSites, memoizedConnectedSiteIds ),
		[ rawSyncSites, memoizedConnectedSiteIds ]
	);

	return {
		syncSites: syncSitesWithSyncSupportForSelectedSite,
		isFetching: isFetchingSites.current,
		refetchSites: fetchSites,
	};
};
