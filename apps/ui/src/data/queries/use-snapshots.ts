import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { SnapshotUsage } from '@/data/core';

export const SNAPSHOTS_QUERY_KEY = [ 'snapshots' ] as const;
export const SNAPSHOT_USAGE_QUERY_KEY = [ 'snapshot-usage' ] as const;

function getSnapshotsQueryKey( userId?: number ) {
	return userId === undefined
		? SNAPSHOTS_QUERY_KEY
		: ( [ ...SNAPSHOTS_QUERY_KEY, userId ] as const );
}

function getSnapshotUsageQueryKey( userId?: number ) {
	return userId === undefined
		? SNAPSHOT_USAGE_QUERY_KEY
		: ( [ ...SNAPSHOT_USAGE_QUERY_KEY, userId ] as const );
}

export function useSnapshots( userId?: number ) {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	const query = useQuery( {
		queryKey: getSnapshotsQueryKey( userId ),
		queryFn: () => connector.getSnapshots(),
		enabled: !! authUser,
		select: ( snapshots ) =>
			userId === undefined
				? snapshots
				: snapshots.filter( ( snapshot ) => snapshot.userId === userId ),
	} );
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
			queryClient.setQueryData< SnapshotUsage | null >(
				getSnapshotUsageQueryKey( userId ),
				( current ) => ( current ? { ...current, siteCount: 0 } : current )
			);
		},
	} );
}
