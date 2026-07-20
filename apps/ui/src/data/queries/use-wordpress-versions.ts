import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const WORDPRESS_VERSIONS_QUERY_KEY = [ 'wordpress-versions' ] as const;

export function useWordPressVersions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_VERSIONS_QUERY_KEY,
		queryFn: () => connector.getWordPressVersions(),
		staleTime: 60 * 60 * 1000,
		retry: 1,
	} );
}
