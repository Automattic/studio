import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { GlobalStyles, SiteDetails } from '@/data/core';

export const globalStylesQueryKey = ( siteId: string ) => [ 'global-styles', siteId ] as const;

export function useGlobalStyles( site: SiteDetails ) {
	const connector = useConnector();

	return useQuery< GlobalStyles >( {
		queryKey: globalStylesQueryKey( site.id ),
		queryFn: () => connector.getGlobalStyles( site.id ),
		enabled: site.running,
		retry: false,
		meta: { persist: false },
	} );
}
