import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { SnapshotUsage } from '@/data/core';

export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;
export const SNAPSHOT_USAGE_QUERY_KEY = [ 'snapshot-usage' ] as const;

function getSnapshotUsageQueryKey( userId?: number ) {
	return userId === undefined
		? SNAPSHOT_USAGE_QUERY_KEY
		: ( [ ...SNAPSHOT_USAGE_QUERY_KEY, userId ] as const );
}

export function useSnapshots( userId?: number ) {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	const query = useQuery( {
		queryKey: SNAPSHOTS_QUERY_KEY,
		queryFn: () => connector.getSnapshots(),
		enabled: !! authUser,
		select: ( snapshots ) =>
			userId === undefined
				? snapshots
				: snapshots.filter( ( snapshot ) => snapshot.userId === userId ),
	} );
	// Preview sites belong to the signed-in WordPress.com account. Disabling
	// the query alone isn't enough — React Query keeps the cached list around
	// after logout, so hide it explicitly while signed out.
	return { ...query, data: authUser ? query.data : undefined };
}

export function useSnapshotUsage( userId?: number ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: getSnapshotUsageQueryKey( userId ),
		queryFn: () => connector.getSnapshotUsage(),
		meta: { persist: false },
	} );
}

export function useDeleteAllSnapshots( userId?: number ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.deleteAllSnapshots(),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			void queryClient.invalidateQueries( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } );
			// Zero the count right away so the meter doesn't sit on the stale
			// value while the invalidated usage query refetches.
			queryClient.setQueryData< SnapshotUsage | null >(
				getSnapshotUsageQueryKey( userId ),
				( current ) => ( current ? { ...current, siteCount: 0 } : current )
			);
		},
	} );
}
