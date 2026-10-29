import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useUserPreferences } from './use-user-preferences';

export function useBrowserInfo() {
	const connector = useConnector();
	const { data } = useUserPreferences();
	return useQuery( {
		queryKey: [ 'browser-info', data?.browser ?? null ],
		queryFn: () => connector.getBrowserInfo(),
		enabled: !! data,
		staleTime: 30_000,
		meta: { persist: false },
	} );
}
