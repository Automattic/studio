import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const debugLogExistsQueryKey = ( siteId: string ) => [ 'debug-log-exists', siteId ] as const;

/**
 * Whether the site has a `wp-content/debug.log` yet. WordPress writes it lazily,
 * so it can't be derived from the site's settings. `persist: false` keeps a
 * stale answer from rehydrating out of localStorage.
 *
 * Pass the site's saved `enableDebugLog` as `enabled`, not the form's unsaved
 * value: ticking the checkbox doesn't write the file, the restart on save does.
 */
export function useDebugLogExists( siteId: string, enabled: boolean ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: debugLogExistsQueryKey( siteId ),
		queryFn: () => connector.siteDebugLogExists( siteId ),
		enabled: enabled && connector.capabilities.openInOS,
		// An unresolvable site means "no log", not a transient failure.
		retry: false,
		meta: { persist: false },
	} );
}
