import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const WORDPRESS_VERSIONS_QUERY_KEY = [ 'wordpress-versions' ] as const;

/**
 * Installable WordPress versions for the create-site and site-settings
 * forms. The list changes only when WordPress ships a release, so keep it
 * fresh for an hour; failures fall back to the form's static default
 * rather than blocking site creation.
 */
export function useWordPressVersions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_VERSIONS_QUERY_KEY,
		queryFn: () => connector.getWordPressVersions(),
		staleTime: 60 * 60 * 1000,
		retry: 1,
	} );
}
