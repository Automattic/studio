import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useRef, useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';
import { useSiteDetails } from './use-site-details';

type SyncSupport = 'unsupported' | 'syncable' | 'needs-transfer' | 'already-connected';

export type SyncSite = {
	id: number;
	localSiteId?: string;
	name: string;
	url: string;
	isStaging: boolean;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
};

type SitesEndpointSite = {
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
	sites: SitesEndpointSite[];
};

const STUDIO_SYNC_FEATURE_NAME = 'studio-sync';

function getSyncSupport( site: SitesEndpointSite, connectedSiteIds: number[] ): SyncSupport {
	if ( connectedSiteIds.some( ( id ) => id === site.ID ) ) {
		return 'already-connected';
	}
	if ( ! site.plan.features.active.includes( STUDIO_SYNC_FEATURE_NAME ) ) {
		return 'unsupported';
	}
	if ( ! site.is_wpcom_atomic ) {
		return 'needs-transfer';
	}
	return 'syncable';
}

function transformSiteResponse(
	sites: SitesEndpointSite[],
	connectedSiteIds: number[]
): SyncSite[] {
	return sites.map( ( site ) => {
		return {
			id: site.ID,
			name: site.name,
			url: site.URL,
			isStaging: site.is_wpcom_staging_site,
			stagingSiteIds: site.options.wpcom_staging_blog_ids,
			syncSupport: getSyncSupport( site, connectedSiteIds ),
		};
	} );
}

const useSyncSites = () => {
	const [ syncSites, setSyncSites ] = useState< SyncSite[] >( [] );
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );
	const { isAuthenticated, client } = useAuth();
	const { selectedSite } = useSiteDetails();
	const localSiteId = selectedSite?.id;
	const isFetchingSites = useRef( false );
	const isOffline = useOffline();

	// Load connected sites
	const loadConnectedSites = useCallback( async () => {
		if ( ! localSiteId ) {
			return;
		}

		try {
			const sites = await getIpcApi().getConnectedWpcomSites( localSiteId );
			setConnectedSites( sites );
		} catch ( error ) {
			console.error( 'Failed to load connected sites:', error );
			setConnectedSites( [] );
		}
	}, [ localSiteId ] );

	useEffect( () => {
		if ( isAuthenticated ) {
			loadConnectedSites();
		}
	}, [ isAuthenticated, loadConnectedSites ] );

	// Connect a site
	const connectSite = async ( site: SyncSite ) => {
		if ( ! localSiteId ) {
			return;
		}
		try {
			const newConnectedSites = await getIpcApi().connectWpcomSite( site, localSiteId );
			setConnectedSites( newConnectedSites );
		} catch ( error ) {
			console.error( 'Failed to connect site:', error );
			throw error;
		}
	};

	// Disconnect a site
	const disconnectSite = async ( siteId: number ) => {
		if ( ! localSiteId ) {
			return;
		}
		try {
			const newDisconnectedSites = await getIpcApi().disconnectWpcomSite( siteId, localSiteId );
			setConnectedSites( newDisconnectedSites );
		} catch ( error ) {
			console.error( 'Failed to disconnect site:', error );
			throw error;
		}
	};

	// Fetch real sites from the API
	useEffect( () => {
		if ( ! client?.req || isFetchingSites.current || ! isAuthenticated || isOffline ) {
			return;
		}

		isFetchingSites.current = true;

		client.req
			.get< SitesEndpointResponse >(
				{
					apiNamespace: 'rest/v1.2',
					path: `/me/sites`,
				},
				{
					fields: 'name,ID,URL,plan,is_wpcom_staging_site,is_wpcom_atomic,options',
					filter: 'atomic,wpcom',
					options: 'created_at,wpcom_staging_blog_ids',
				}
			)
			.then( ( response ) => {
				setSyncSites(
					transformSiteResponse(
						response.sites,
						connectedSites.map( ( { id } ) => id )
					)
				);
			} )
			.catch( ( error ) => {
				Sentry.captureException( error );
				console.error( error );
			} )
			.finally( () => {
				isFetchingSites.current = false;
			} );
	}, [ client?.req, connectedSites, isAuthenticated, isOffline ] );

	// Determine if the site is already connected
	const isSiteAlreadyConnected = ( siteId: number ) =>
		connectedSites.some( ( site ) => site.id === siteId );

	return {
		syncSites: syncSites.map( ( site ) => ( {
			...site,
			syncSupport: isSiteAlreadyConnected( site.id ) ? 'already-connected' : site.syncSupport,
		} ) ),
		connectedSites,
		connectSite,
		disconnectSite,
		isFetching: isFetchingSites.current,
	};
};

export { useSyncSites };
