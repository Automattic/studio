import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteDesign, SiteDetails } from '@/data/core';

export const siteDesignQueryKey = ( siteId: string ) => [ 'site-design', siteId ] as const;

export function useSiteDesign( site: SiteDetails ) {
	const connector = useConnector();

	return useQuery< SiteDesign | null >( {
		queryKey: siteDesignQueryKey( site.id ),
		queryFn: () => connector.getSiteDesign( site.id ),
		enabled: site.running,
		retry: false,
		meta: { persist: false },
	} );
}
