import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const SITES_QUERY_KEY = [ 'sites' ] as const;

export function useSites() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SITES_QUERY_KEY,
		queryFn: () => connector.getSites(),
	} );
}

export function useCreateSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( params: { name: string } ) => connector.createSite( params ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}

export function useDeleteSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( id: string ) => connector.deleteSite( id ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}
