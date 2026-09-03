import { fetchStudioBlueprints } from '@studio/common/lib/studio-blueprints-api';
import { useQuery } from '@tanstack/react-query';
import { useUserLocale } from './use-user-locale';

export const BLUEPRINTS_QUERY_KEY = [ 'blueprints' ] as const;

export function useBlueprints() {
	const locale = useUserLocale();
	return useQuery( {
		queryKey: [ ...BLUEPRINTS_QUERY_KEY, locale ],
		queryFn: () => fetchStudioBlueprints( locale ),
		staleTime: 60 * 60 * 1000,
		retry: 1,
	} );
}
