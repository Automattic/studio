import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteStorageUsage } from '@/data/core';

export const siteStorageUsageQueryKey = ( siteId: string ) =>
	[ 'site-storage-usage', siteId ] as const;

export function useSiteStorageUsage( siteId: string ) {
	const connector = useConnector();

	return useQuery< SiteStorageUsage | null >( {
		queryKey: siteStorageUsageQueryKey( siteId ),
		queryFn: () => connector.getSiteStorageUsage( siteId ),
		staleTime: 5 * 60 * 1000,
		retry: false,
		meta: { persist: false },
	} );
}
