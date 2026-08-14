import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { TracksAuthSource } from '@studio/common/lib/record-tracks-event';

export const AUTH_USER_QUERY_KEY = [ 'auth-user' ] as const;

export function useAuthUser() {
	const connector = useConnector();
	const queryClient = useQueryClient();

	useEffect( () => {
		return connector.onAuthStateChanged?.( () => {
			void queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } );
		} );
	}, [ connector, queryClient ] );

	return useQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => connector.getAuthUser(),
	} );
}

// `source` is required so every login affordance names itself for `studio_wpcom_auth` — a missed one is
// a type error rather than a silent `unknown` in the data.
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
	return useMutation( {
		mutationFn: () => connector.logout(),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: AUTH_USER_QUERY_KEY } ),
	} );
}
