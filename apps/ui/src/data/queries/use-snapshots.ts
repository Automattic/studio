import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SnapshotUsage } from '@/data/core';

export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;
export const SNAPSHOT_USAGE_QUERY_KEY = [ 'snapshot-usage' ] as const;

export function useSnapshots() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SNAPSHOTS_QUERY_KEY,
		queryFn: () => connector.getSnapshots(),
	} );
}

export function useSnapshotUsage() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SNAPSHOT_USAGE_QUERY_KEY,
		queryFn: () => connector.getSnapshotUsage(),
	} );
}

export function useDeleteAllSnapshots() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.deleteAllSnapshots(),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			queryClient.setQueryData< SnapshotUsage | null >( SNAPSHOT_USAGE_QUERY_KEY, ( current ) =>
				current ? { ...current, siteCount: 0 } : current
			);
		},
	} );
}
