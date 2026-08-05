import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteDetails } from '@/data/core';

export const THEME_DETAILS_QUERY_KEY = [ 'theme-details' ] as const;

export function useThemeDetails( site: SiteDetails ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...THEME_DETAILS_QUERY_KEY, site.id ],
		queryFn: () => connector.getThemeDetails( site.id ),
		initialData: site.themeDetails,
		enabled: site.running,
		retry: 1,
	} );
}
