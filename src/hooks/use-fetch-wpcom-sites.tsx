import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';

type SyncSupport =
	| 'unsupported'
	| 'syncable'
	| 'needs-transfer'
	| 'already-connected'
	| 'jetpack-site'
	| 'deleted';

export type SyncSite = {
	id: number;
	localSiteId: string;
	name: string;
	url: string;
	isStaging: boolean;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
	lastPullTimestamp: string | null;
	lastPushTimestamp: string | null;
};

type SitesEndpointSite = {
	ID: number;
	is_wpcom_atomic: boolean;
	is_wpcom_staging_site: boolean;
	name: string;
	URL: string;
	jetpack?: boolean;
	options?: {
		created_at: string;
		wpcom_staging_blog_ids: number[];
	};
	plan?: {
		expired: boolean;
		features: {
			active: string[];
			available: Record< string, string[] >;
		};
		is_free: boolean;
		product_id: number;
		product_name_short: string;
		product_slug: string;
		user_is_owner: boolean;
	};
	is_deleted: boolean;
};

type SitesEndpointResponse = {
	sites: SitesEndpointSite[];
};

const STUDIO_SYNC_FEATURE_NAME = 'studio-sync';

function isJetpackSite( site: SitesEndpointSite ): boolean {
	return !! site.jetpack && ! site.is_wpcom_atomic;
}

function hasSupportedPlan( site: SitesEndpointSite ): boolean {
	return !! site.plan && site.plan.features.active.includes( STUDIO_SYNC_FEATURE_NAME );
}

function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
	if ( site.is_deleted ) {
		return 'deleted';
	}
	if ( isJetpackSite( site ) && ! hasSupportedPlan( site ) ) {
		return 'jetpack-site';
	}
	if ( ! hasSupportedPlan( site ) ) {
		return 'unsupported';
	}
	if ( ! site.is_wpcom_atomic ) {
		return 'needs-transfer';
	}
	if ( connectedSiteIds.some( ( id ) => id === site.ID ) ) {
		return 'already-connected';
	}
	return 'syncable';
}

export function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport
): SyncSite {
	return {
		id: site.ID,
		localSiteId: '',
		name: site.name,
		url: site.URL,
		isStaging: site.is_wpcom_staging_site,
		stagingSiteIds: site.options?.wpcom_staging_blog_ids ?? [],
		syncSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

function transformSiteResponse(
	sites: SitesEndpointSite[],
	connectedSiteIds: number[]
): SyncSite[] {
	return sites.reduce( ( acc: SyncSite[], site ) => {
		if ( site.is_deleted && ! connectedSiteIds.some( ( id ) => id === site.ID ) ) {
			return acc;
		}

		acc.push( transformSingleSiteResponse( site, getSyncSupport( site, connectedSiteIds ) ) );

		return acc;
	}, [] );
}

export const useFetchWpComSites = ( connectedSiteIds: number[] ) => {
	const [ rawSyncSites, setRawSyncSites ] = useState< SitesEndpointSite[] >( [] );
	const { isAuthenticated, client } = useAuth();
	const isFetchingSites = useRef( false );
	const isInitialized = useRef( false ); // By default syncSites are always empty array, so this flag helps to determine if we have fetched sites at least once
	const isOffline = useOffline();

	const joinedConnectedSiteIds = connectedSiteIds.join( ',' );
	// we need this trick to avoid unnecessary re-renders,
	// as a result different instances of the same array don't trigger refetching
	const memoizedConnectedSiteIds: number[] = useMemo(
		() =>
			joinedConnectedSiteIds
				? joinedConnectedSiteIds.split( ',' ).map( ( id ) => parseInt( id, 10 ) )
				: [],
		[ joinedConnectedSiteIds ]
	);

	const fetchSites = useCallback( async (): Promise< SitesEndpointSite[] > => {
		if ( ! client?.req || isFetchingSites.current || ! isAuthenticated || isOffline ) {
			return [];
		}

		isFetchingSites.current = true;

		try {
			const response = await client.req.get< SitesEndpointResponse >(
				{
					apiNamespace: 'rest/v1.2',
					path: `/me/sites`,
				},
				{
					fields:
						'name,ID,URL,plan,is_wpcom_staging_site,is_wpcom_atomic,options,jetpack,is_deleted',
					filter: 'atomic,wpcom',
					options: 'created_at,wpcom_staging_blog_ids',
					site_activity: 'active',
				}
			);

			isInitialized.current = true;

			setRawSyncSites( response.sites );

			return response.sites;
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
			return [];
		} finally {
			isFetchingSites.current = false;
		}
	}, [ client?.req, isAuthenticated, isOffline ] );

	useEffect( () => {
		fetchSites();
	}, [ fetchSites ] );

	const refetchSites = useCallback( () => {
		return fetchSites();
	}, [ fetchSites ] );

	const syncSites = useMemo(
		() => transformSiteResponse( rawSyncSites, memoizedConnectedSiteIds ),
		[ rawSyncSites, memoizedConnectedSiteIds ]
	);

	return {
		syncSites,
		isFetching: isFetchingSites.current,
		isInitialized: isInitialized.current,
		refetchSites,
	};
};
