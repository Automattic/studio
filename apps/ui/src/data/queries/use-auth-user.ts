import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	rememberAccountJourney,
	clearAccountJourneys,
	useAnalyticsExposure,
} from '@/data/account-analytics';
import { dismissToast, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { clearPreviewReady } from '@/data/preview-ready';
import { USER_SCOPED_QUERY_KEYS } from '@/data/queries/user-scoped-query-keys';
import type { AuthAnalytics } from '@studio/common/lib/auth-tracks';
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
	const connector = useConnector();
	const { data, isSuccess, error, refetch } = useAuthUser();
	useEffect( () => {
		if ( error ) {
			toast.error( __( 'Couldn’t refresh your account' ), {
				id: 'auth-user-error',
				description: error.message,
				action: { label: __( 'Retry' ), onClick: () => refetch( { throwOnError: true } ) },
			} );
		}
	}, [ error, refetch ] );
	const userId = data?.id ?? null;
	const previousUserId = useRef< number | null >( undefined );
	useEffect( () => {
		if ( ! isSuccess ) {
			return;
		}
		dismissToast( 'auth-user-error' );
		if ( previousUserId.current != null && previousUserId.current !== userId )
			clearAccountJourneys( connector );
		if ( previousUserId.current !== undefined && previousUserId.current !== userId ) {
			toast.success(
				userId === null ? __( 'Logged out of WordPress.com' ) : __( 'Logged in to WordPress.com' )
			);
		}
		previousUserId.current = userId;
	}, [ isSuccess, userId, connector ] );
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
	analytics,
	scope,
	trackExposure = false,
}: {
	signup?: boolean;
	source: TracksAuthSource;
	analytics?: AuthAnalytics;
	scope?: string;
	trackExposure?: boolean;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ journeyId ] = useState( () => crypto.randomUUID() );
	const context = analytics
		? { ...analytics, journey_id: analytics.journey_id ?? journeyId }
		: undefined;
	const promptRef = useAnalyticsExposure< HTMLButtonElement >(
		TRACKS_EVENTS.ACCOUNT_PROMPT_VIEWED,
		{ source, ...context },
		trackExposure
	);
	const mutationKey = [ 'authenticate', signup ? 'signup' : 'login' ];
	const login = useMutation( {
		mutationKey,
		mutationFn: () => {
			if ( context ) rememberAccountJourney( connector, context, scope );
			return context
				? connector.authenticate( signup, source, context )
				: connector.authenticate( signup, source );
		},
		onSuccess: () => queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } ),
	} );
	// A login outlives the prompt that started it, so one opened meanwhile waits for it.
	const running = useIsMutating( { mutationKey } ) > 0;
	return { ...login, promptRef, isPending: login.isPending || running };
}

export function useLogout() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const removeUserScopedQueries = useRemoveUserScopedQueries();
	return useMutation( {
		mutationFn: () => connector.logout(),
		onSuccess: () => {
			clearAccountJourneys( connector );
			removeUserScopedQueries();
			void queryClient.resetQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		},
	} );
}
