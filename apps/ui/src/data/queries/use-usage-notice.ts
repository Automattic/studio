import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const USAGE_NOTICE_QUERY_KEY = [ 'usage-notice' ] as const;

// Whether the one-time notice that usage statistics are linked to the WordPress.com account is due.
export function useUsageNoticePending() {
	const connector = useConnector();
	return useQuery( {
		queryKey: USAGE_NOTICE_QUERY_KEY,
		queryFn: () => connector.getUsageNoticePending(),
		meta: { persist: false },
	} );
}

export function useSetUsageNoticeSeen() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.setUsageNoticeSeen(),
		onMutate: async () => {
			await queryClient.cancelQueries( { queryKey: USAGE_NOTICE_QUERY_KEY } );
			queryClient.setQueryData( USAGE_NOTICE_QUERY_KEY, false );
		},
		onSettled: () => queryClient.invalidateQueries( { queryKey: USAGE_NOTICE_QUERY_KEY } ),
	} );
}
