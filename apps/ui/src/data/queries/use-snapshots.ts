import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { Snapshot, SnapshotUsage } from '@/data/core';

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
			// Zero the count directly instead of refetching: the wpcom usage
			// counter is eventually consistent, so an immediate refetch can
			// overwrite the correct zero with the stale pre-delete count. The
			// next mount/focus refetch (staleTime 0) reconciles with the server.
			queryClient.setQueryData< SnapshotUsage | null >(
				getSnapshotUsageQueryKey( userId ),
				( current ) => ( current ? { ...current, siteCount: 0 } : current )
			);
		},
	} );
}

/**
 * Keeps the cached preview list in step with the CLI, whoever changed it: this
 * window, the agent or a terminal. Mount once near the app root.
 */
export function useSyncSnapshotsWithEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	useEffect( () => {
		return connector.onSnapshotEvent( ( event ) => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } );
			if ( event.event === SNAPSHOT_EVENTS.DELETED_ALL ) {
				queryClient.setQueryData< Snapshot[] >( SNAPSHOTS_QUERY_KEY, [] );
				return;
			}
			if ( ! ( 'snapshotUrl' in event ) ) {
				return;
			}
			const { snapshot, snapshotUrl } = event;
			queryClient.setQueryData< Snapshot[] >( SNAPSHOTS_QUERY_KEY, ( current = [] ) => {
				const others = current.filter( ( item ) => item.url !== snapshotUrl );
				return event.event === SNAPSHOT_EVENTS.DELETED || ! snapshot
					? others
					: [ ...others, snapshot ];
			} );
		} );
	}, [ connector, queryClient ] );
}

export function useDeleteSnapshot() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: ( { hostname }: { hostname: string } ) => connector.deleteSnapshot( hostname ),
		onError: () => toast.error( __( "Couldn't delete the preview site" ) ),
	} );
}

export function useRenameSnapshot() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: ( { hostname, name }: { hostname: string; name: string } ) =>
			connector.renameSnapshot( hostname, name ),
		onError: () => toast.error( __( "Couldn't rename the preview site" ) ),
	} );
}
