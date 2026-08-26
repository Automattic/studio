import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const APP_GLOBALS_QUERY_KEY = [ 'app-globals' ] as const;

export function useAppGlobals() {
	const connector = useConnector();
	return useQuery( {
		queryKey: APP_GLOBALS_QUERY_KEY,
		queryFn: () => connector.getAppGlobals(),
		staleTime: Infinity,
		meta: { persist: false },
	} );
}
