import * as Sentry from '@sentry/electron/renderer';
import { useCallback, useEffect, useState } from 'react';
import { LIMIT_OF_ZIP_SITES_PER_USER } from '../constants';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';
import { useSiteDetails } from './use-site-details';
import { useFetchSnapshots } from './use-fetch-snaphsots';
import ForgeExternalsPlugin from '@timfish/forge-externals-plugin';

export interface UsageSite {
	atomic_site_id: number;
}

export function useSiteUsage() {
	const [ isLoading, setIsLoading ] = useState( false );
	const { snapshots } = useSiteDetails();
	const [ siteCount, setSiteCount ] = useState( snapshots.length );
	const [ siteLimit, setSiteLimit ] = useState( LIMIT_OF_ZIP_SITES_PER_USER );
	const { client } = useAuth();
	const isOffline = useOffline();

	const fetchSiteUsage = useCallback( async () => {
		if ( ! client?.req || isOffline ) {
			return;
		}
		setIsLoading( true );
		try {
			const response: { site_count: number; site_limit: number } = await client.req.get( {
				path: '/jurassic-ninja/usage',
				apiNamespace: 'wpcom/v2',
			} );
			return response;
		} catch ( error ) {
			Sentry.captureException( error );
		} finally {
			setIsLoading( false );
		}
	}, [ client?.req, isOffline ] );

	useEffect( () => {
		// If client is not ready, fail early
		// However, we still want to show the user the snapshots they have locally
		// to provide a better user experience
		if ( ! client ) {
			setSiteCount( snapshots.length );
			setSiteLimit( LIMIT_OF_ZIP_SITES_PER_USER );
			return;
		}
		const fetchStats = async () => {
			const response = await fetchSiteUsage();
			if ( ! response ) {
				// Fetching failed, fallback to what we have in the client
				setIsLoading( false );
				setSiteCount( snapshots.length );
				setSiteLimit( LIMIT_OF_ZIP_SITES_PER_USER );
				return;
			}
			const { site_count, site_limit } = response;
			setSiteCount( site_count );
			setSiteLimit( site_limit );
		};
		fetchStats();
	}, [ fetchSiteUsage, snapshots.length, client ] );

	return { fetchSiteUsage, isLoading, siteCount, siteLimit };
}
