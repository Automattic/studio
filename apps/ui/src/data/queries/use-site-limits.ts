import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const SITE_LIMITS_QUERY_KEY = [ 'site-limits' ] as const;

/** The plan's limits on sites, where the connector has them (Studio Cloud); null elsewhere. */
export function useSiteLimits() {
	const connector = useConnector();
	const { getSiteLimits } = connector;
	return useQuery( {
		queryKey: SITE_LIMITS_QUERY_KEY,
		queryFn: () => ( getSiteLimits ? getSiteLimits.call( connector ) : null ),
		enabled: !! getSiteLimits,
		// The counts change as sites are created and started, so opening the panel reads them anew.
		refetchOnMount: 'always',
		meta: { persist: false },
	} );
}
