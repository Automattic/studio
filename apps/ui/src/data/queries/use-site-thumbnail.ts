import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const siteThumbnailQueryKey = ( siteId: string ) =>
	[ 'site-preview-thumbnail', siteId ] as const;

export function useSiteThumbnail( siteId: string ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: siteThumbnailQueryKey( siteId ),
		queryFn: () => connector.getSiteThumbnail( siteId ),
		meta: { persist: false },
	} );
}
