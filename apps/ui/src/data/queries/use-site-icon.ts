import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

/** The site's Site Icon as a data URL, or null when it has none or the host can't read it. */
export function useSiteIcon( siteId: string ): string | null {
	const connector = useConnector();
	const { data } = useQuery( {
		queryKey: [ 'site-icon', siteId ],
		queryFn: async () => ( await connector.getSiteIcon?.( siteId ) ) ?? null,
		enabled: Boolean( connector.getSiteIcon ),
		staleTime: 30_000,
	} );
	return data ?? null;
}
