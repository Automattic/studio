import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const INSTALLED_APPS_QUERY_KEY = [ 'installed-apps' ] as const;

export function useInstalledApps() {
	const connector = useConnector();
	return useQuery( {
		queryKey: INSTALLED_APPS_QUERY_KEY,
		queryFn: () => connector.getInstalledApps(),
		staleTime: Infinity,
		// Which apps are on disk is machine state that changes outside Studio,
		// so it must not survive in the persisted cache: paired with
		// `staleTime: Infinity` a stale answer would outlive every restart, and
		// an editor installed after Studio's first run would stay invisible.
		meta: { persist: false },
	} );
}
