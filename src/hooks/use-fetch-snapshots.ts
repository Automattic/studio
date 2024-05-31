import * as Sentry from '@sentry/electron/renderer';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';
import { useSiteUsage } from './use-site-usage';

interface FetchSnapshotResponse {
	sites: { atomic_site_id: number }[];
}

export function useFetchSnapshots() {
	const [ allSnapshots, setAllSnapshots ] = useState< Pick< Snapshot, 'atomicSiteId' >[] | null >(
		null
	);
	const { siteCount } = useSiteUsage();
	const [ isLoading, setIsLoading ] = useState( false );
	const { client } = useAuth();
	const isOffline = useOffline();

	const fetchAllSnapshots = useCallback( async () => {
		if ( ! client?.req || isOffline ) {
			return null;
		}
		setIsLoading( true );
		try {
			const response: FetchSnapshotResponse = await client.req.get( {
				path: '/jurassic-ninja/list',
				apiNamespace: 'wpcom/v2',
			} );
			const sites: Pick< Snapshot, 'atomicSiteId' >[] =
				response.sites?.map( ( { atomic_site_id } ) => ( { atomicSiteId: atomic_site_id } ) ) ?? [];
			return sites;
		} catch ( error ) {
			Sentry.captureException( error );
		} finally {
			setIsLoading( false );
		}
	}, [ client?.req, isOffline ] );

	useEffect( () => {
		if ( ! client ) {
			return;
		}
		const fetchSnapshots = async () => {
			const sites = await fetchAllSnapshots();
			if ( ! sites ) {
				return;
			}
			setAllSnapshots( sites );
			setIsLoading( false );
		};
		fetchSnapshots();
	}, [ client, fetchAllSnapshots, siteCount ] );

	return { fetchAllSnapshots, allSnapshots, isLoading };
}
