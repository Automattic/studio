import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';

export type SyncSupport = 'unsupported' | 'syncable' | 'needs-transfer' | 'already-connected';

export type SyncSite = {
	id: number;
	name: string;
	url: string;
	isStaging: boolean;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
};

type Site = {
	ID: number;
	is_wpcom_atomic: boolean;
	is_wpcom_staging_site: boolean;
	name: string;
	URL: string;
	options: {
		created_at: string;
		wpcom_staging_blog_ids: number[];
	};
	plan: {
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
};

type SitesEndpointResponse = {
	sites: Site[];
};

function getSyncSupport( site: Site ): SyncSupport {
	if ( site.plan.product_id !== 1008 ) {
		return 'unsupported';
	}
	if ( ! site.is_wpcom_atomic ) {
		return 'needs-transfer';
	}
	return 'syncable';
}

function transformSiteResponse( sites: Site[] ): SyncSite[] {
	return sites.map( ( site ) => {
		return {
			id: site.ID,
			name: site.name,
			url: site.URL,
			isStaging: site.is_wpcom_staging_site,
			stagingSiteIds: site.options.wpcom_staging_blog_ids,
			syncSupport: getSyncSupport( site ),
		};
	} );
}

export function useSyncSites() {
	const [ syncSites, setSyncSites ] = useState< SyncSite[] >( [] );
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { isAuthenticated, client } = useAuth();
	const isFetchingSites = useRef( false );
	const isOffline = useOffline();

	const fetchSites = useCallback( async () => {
		if ( ! client?.req || isFetchingSites.current || ! isAuthenticated || isOffline ) {
			return;
		}

		isFetchingSites.current = true;

		try {
			const response = await client.req.get< SitesEndpointResponse >(
				{
					apiNamespace: 'rest/v1.2',
					path: `/me/sites`,
				},
				{
					fields: 'name,ID,URL,plan,is_wpcom_staging_site,is_wpcom_atomic,options',
					filter: 'atomic,wpcom',
					options: 'created_at,wpcom_staging_blog_ids',
				}
			);

			if ( response ) {
				setSyncSites( transformSiteResponse( response.sites ) );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		} finally {
			isFetchingSites.current = false;
		}
	}, [ client?.req, isAuthenticated, isOffline ] );

	useEffect( () => {
		fetchSites();
	}, [ fetchSites, isOffline ] );

	const isSiteAlreadyConnected = ( siteId: number ) =>
		connectedSites.some( ( site ) => site.id === siteId );

	return {
		syncSites: syncSites.map( ( site ) => ( {
			...site,
			syncSupport: isSiteAlreadyConnected( site.id ) ? 'already-connected' : site.syncSupport,
		} ) ),
		connectedSites,
		setConnectedSites,
		isFetching: isFetchingSites.current,
	};
}
