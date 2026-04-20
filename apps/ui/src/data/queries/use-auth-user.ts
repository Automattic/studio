import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const AUTH_USER_QUERY_KEY = [ 'auth-user' ] as const;

export function useAuthUser() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => connector.getAuthUser(),
	} );
}

export function useLogin() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.authenticate(),
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
