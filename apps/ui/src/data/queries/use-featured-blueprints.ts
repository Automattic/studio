import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useUserLocale } from './use-user-locale';

const FEATURED_BLUEPRINTS_QUERY_KEY = [ 'featured-blueprints' ] as const;

export function useFeaturedBlueprints() {
	const connector = useConnector();
	const locale = useUserLocale();
	return useQuery( {
		queryKey: [ ...FEATURED_BLUEPRINTS_QUERY_KEY, locale ?? 'en' ],
		queryFn: () => connector.getFeaturedBlueprints( locale ),
		// Featured blueprints rarely change — keep them fresh for an hour so
		// re-opening the selector doesn't spam the public endpoint.
		staleTime: 60 * 60 * 1000,
	} );
}
