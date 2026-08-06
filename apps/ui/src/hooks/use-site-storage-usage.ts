import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteStorageUsage } from '@/data/core';

export const siteStorageUsageQueryKey = ( siteId: string ) =>
	[ 'site-storage-usage', siteId ] as const;

/**
 * Disk usage for a site folder, broken down by what's taking up the space.
 *
 * Measuring walks the whole install, so this is deliberately lazy: it's only
 * worth asking for on a surface that shows it, and the answer stays fresh for
 * long enough that scrolling past it twice doesn't re-walk the disk.
 */
export function useSiteStorageUsage( siteId: string, { enabled = true } = {} ) {
	const connector = useConnector();
	return useQuery< SiteStorageUsage | null >( {
		queryKey: siteStorageUsageQueryKey( siteId ),
		queryFn: () => connector.getSiteStorageUsage( siteId ),
		enabled,
		staleTime: 5 * 60_000,
		retry: false,
	} );
}
