import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SNAPSHOTS_QUERY_KEY, SNAPSHOT_USAGE_QUERY_KEY } from '@/data/queries/use-snapshots';
import {
	ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
	SYNCABLE_WPCOM_SITES_QUERY_KEY,
} from '@/data/queries/use-wpcom-sites';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export const AUTH_USER_QUERY_KEY = [ 'auth-user' ] as const;

// Removed (not just invalidated) on auth transitions so a different user
// never sees stale data from the persisted cache.
const CONNECTED_WPCOM_SITES_PREFIX = connectedWpcomSitesQueryKey( '' ).slice( 0, 1 );
const USER_SCOPED_QUERY_KEYS: ReadonlyArray< readonly string[] > = [
	SYNCABLE_WPCOM_SITES_QUERY_KEY,
	ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
	CONNECTED_WPCOM_SITES_PREFIX,
	SNAPSHOTS_QUERY_KEY,
	SNAPSHOT_USAGE_QUERY_KEY,
];

export function useAuthUser() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const removeUserScopedQueries = useRemoveUserScopedQueries();

	useEffect( () => {
		return connector.onAuthStateChanged?.( () => {
			removeUserScopedQueries();
			void queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		} );
	}, [ connector, queryClient, removeUserScopedQueries ] );

	return useQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => connector.getAuthUser(),
	} );
}

function useRemoveUserScopedQueries() {
	const queryClient = useQueryClient();
	return useCallback( () => {
		for ( const key of USER_SCOPED_QUERY_KEYS ) {
			queryClient.removeQueries( { queryKey: key } );
		}
	}, [ queryClient ] );
}

export function useLogin( {
	signup = false,
	source,
}: {
	signup?: boolean;
	source: TracksAuthSource;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.authenticate( signup, source ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } ),
	} );
}

export function useLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const removeUserScopedQueries = useRemoveUserScopedQueries();
	return useMutation( {
		mutationFn: () => connector.logout(),
		onSuccess: () => {
			removeUserScopedQueries();
			void queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		},
	} );
}
