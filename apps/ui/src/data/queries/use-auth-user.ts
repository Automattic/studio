import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { clearPreviewReady } from '@/data/preview-ready';
import { USER_SCOPED_QUERY_KEYS } from '@/data/queries/user-scoped-query-keys';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

const AUTH_USER_QUERY_KEY = [ 'auth-user' ] as const;

export function useAuthUser() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => connector.getAuthUser(),
	} );
}

/** Refreshes the account when it changes outside this window. Mount once near the app root. */
export function useSyncAuthUserWithEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const removeUserScopedQueries = useRemoveUserScopedQueries();
	useEffect( () => {
		return connector.onAuthStateChanged?.( () => {
			removeUserScopedQueries();
			// Reset, not invalidate: a sign-in can land while the first lookup is
			// still in flight, and invalidate/refetch dedupe against it — leaving
			// the cache on the pre-login answer.
			void queryClient.resetQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		} );
	}, [ connector, queryClient, removeUserScopedQueries ] );
}

// However the account changed: a login here, a logout in the CLI, an expired token.
export function useAuthChangeToasts() {
	const { data, isSuccess } = useAuthUser();
	const userId = data?.id ?? null;
	const previousUserId = useRef< number | null >( undefined );
	useEffect( () => {
		if ( ! isSuccess ) {
			return;
		}
		if ( previousUserId.current !== undefined && previousUserId.current !== userId ) {
			toast.success(
				userId === null ? __( 'Logged out of WordPress.com' ) : __( 'Logged in to WordPress.com' )
			);
		}
		previousUserId.current = userId;
	}, [ isSuccess, userId ] );
}

function useRemoveUserScopedQueries() {
	const queryClient = useQueryClient();
	return useCallback( () => {
		for ( const key of USER_SCOPED_QUERY_KEYS ) {
			queryClient.removeQueries( { queryKey: key } );
		}
		clearPreviewReady();
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
	const mutationKey = [ 'authenticate', signup ? 'signup' : 'login' ];
	const login = useMutation( {
		mutationKey,
		mutationFn: () => connector.authenticate( signup, source ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } ),
	} );
	// A login outlives the prompt that started it, so one opened meanwhile waits for it.
	const running = useIsMutating( { mutationKey } ) > 0;
	return { ...login, isPending: login.isPending || running };
}

export function useLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const removeUserScopedQueries = useRemoveUserScopedQueries();
	return useMutation( {
		mutationFn: () => connector.logout(),
		onSuccess: () => {
			removeUserScopedQueries();
			void queryClient.resetQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		},
	} );
}
