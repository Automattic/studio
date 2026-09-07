import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const debugLogExistsQueryKey = ( siteId: string ) => [ 'debug-log-exists', siteId ] as const;

/**
 * Whether the site has a `wp-content/debug.log` yet. WordPress writes it lazily
 * and leaves it behind when logging is turned off, so this tracks the file
 * itself rather than the site's setting. `persist: false` keeps a stale answer
 * from rehydrating out of localStorage.
 */
export function useDebugLogExists( siteId: string ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: debugLogExistsQueryKey( siteId ),
		queryFn: () => connector.siteDebugLogExists( siteId ),
		enabled: connector.capabilities.openInOS,
		// An unresolvable site means "no log", not a transient failure.
		retry: false,
		meta: { persist: false },
	} );
}
