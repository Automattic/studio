import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const WAPUU_SCORE_QUERY_KEY = [ 'wapuu-score' ] as const;

export function useWapuuScore() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WAPUU_SCORE_QUERY_KEY,
		queryFn: () => connector.getWapuuScore().then( ( score ) => score ?? null ),
	} );
}

export function useSaveWapuuScore() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( score: number ) => connector.saveWapuuScore( score ),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: WAPUU_SCORE_QUERY_KEY } );
		},
	} );
}
