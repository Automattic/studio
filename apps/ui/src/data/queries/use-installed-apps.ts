import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const INSTALLED_APPS_QUERY_KEY = [ 'installed-apps' ] as const;

export function useInstalledApps() {
	const connector = useConnector();
	return useQuery( {
		queryKey: INSTALLED_APPS_QUERY_KEY,
		queryFn: () => connector.getInstalledApps(),
		// Detecting the default browser spawns a process.
		staleTime: 60 * 1000,
		meta: { persist: false },
	} );
}
