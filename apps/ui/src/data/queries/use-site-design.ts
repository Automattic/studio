import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteDesign, SiteDetails } from '@/data/core';
import type { DesignFix } from '@studio/design-md';

export const siteDesignQueryKey = ( siteId: string ) => [ 'site-design', siteId ] as const;

export function useSiteDesign( site: SiteDetails ) {
	const connector = useConnector();

	return useQuery< SiteDesign | null >( {
		queryKey: siteDesignQueryKey( site.id ),
		queryFn: () => connector.getSiteDesign( site.id ),
		enabled: site.running,
		retry: false,
		meta: { persist: false },
	} );
}

export function useFixSiteDesignDrift( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();

	return useMutation( {
		mutationFn: ( fixes: DesignFix[] ) => connector.fixSiteDesignDrift( siteId, fixes ),
		onSuccess: ( design ) => queryClient.setQueryData( siteDesignQueryKey( siteId ), design ),
	} );
}
