import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const connectedWpcomSitesQueryKey = ( localSiteId: string ) =>
	[ 'connected-wpcom-sites', localSiteId ] as const;

export function useConnectedWpcomSites( localSiteId: string | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: connectedWpcomSitesQueryKey( localSiteId ?? '' ),
		queryFn: () => connector.getConnectedWpcomSites( localSiteId! ),
		enabled: !! localSiteId,
	} );
}
