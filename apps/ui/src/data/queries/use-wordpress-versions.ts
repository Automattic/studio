import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const WORDPRESS_VERSIONS_QUERY_KEY = [ 'wordpress-versions' ] as const;
export const WP_VERSION_QUERY_KEY = [ 'wp-version' ] as const;

export function useWordPressVersions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_VERSIONS_QUERY_KEY,
		queryFn: () => connector.getWordPressVersions(),
		staleTime: 60 * 60 * 1000,
		retry: 1,
	} );
}

// The WordPress version installed at the site's path. Resolves to '-' when it
// can't be read; errors (e.g. the hosted connector) surface as `data:
// undefined` so callers can fall back gracefully.
export function useWpVersion( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...WP_VERSION_QUERY_KEY, siteId ],
		queryFn: () => connector.getWpVersion( siteId ),
		retry: 1,
	} );
}
