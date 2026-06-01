import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const FEATURE_FLAGS_QUERY_KEY = [ 'feature-flags' ] as const;

export function useFeatureFlags() {
	const connector = useConnector();
	return useQuery( {
		queryKey: FEATURE_FLAGS_QUERY_KEY,
		queryFn: () => connector.getFeatureFlags(),
		staleTime: Infinity,
	} );
}
