import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import type { SiteStorageUsage } from '@/data/core';

export const siteStorageUsageQueryKey = ( siteId: string ) =>
	[ 'site-storage-usage', siteId ] as const;

// How long a site has to stay on screen before its disk usage is worth
// measuring. The site workspace remounts per site, so flicking through the
// sidebar would otherwise start a full directory walk for every site passed
// through on the way to the one the user actually wanted.
const MEASURE_DELAY_MS = 400;

function useSettled( delayMs: number ): boolean {
	const [ settled, setSettled ] = useState( false );
	useEffect( () => {
		const timer = setTimeout( () => setSettled( true ), delayMs );
		return () => clearTimeout( timer );
	}, [ delayMs ] );
	return settled;
}

export function useSiteStorageUsage( siteId: string ) {
	const connector = useConnector();
	const settled = useSettled( MEASURE_DELAY_MS );

	return useQuery< SiteStorageUsage | null >( {
		queryKey: siteStorageUsageQueryKey( siteId ),
		queryFn: ( { signal } ) => connector.getSiteStorageUsage( siteId, signal ),
		enabled: settled,
		staleTime: 5 * 60 * 1000,
		retry: false,
		meta: { persist: false },
	} );
}
