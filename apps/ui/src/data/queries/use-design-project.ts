import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const designProjectQueryKey = ( siteId: string ) => [ 'design-project', siteId ] as const;

export function useDesignProject( siteId: string | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: designProjectQueryKey( siteId ?? '' ),
		queryFn: () => connector.getDesignProject( siteId as string ),
		enabled: !! siteId,
		refetchInterval: 1_000,
	} );
}

export function useSelectDesignArtifact( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( artifactId: string ) => connector.selectDesignArtifact( siteId, artifactId ),
		onSuccess: ( project ) => queryClient.setQueryData( designProjectQueryKey( siteId ), project ),
	} );
}
