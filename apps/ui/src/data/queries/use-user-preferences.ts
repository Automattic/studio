import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { UserPreferences, WritableUserPreferences } from '@/data/core';

export const USER_PREFERENCES_QUERY_KEY = [ 'user-preferences' ] as const;

export function useUserPreferences() {
	const connector = useConnector();
	return useQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => connector.getUserPreferences(),
		staleTime: Infinity,
	} );
}

export function useSaveUserPreferences() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( partial: Partial< WritableUserPreferences > ) =>
			connector.setUserPreferences( partial ).then( () => partial ),
		onSuccess: ( partial ) => {
			// Main-process save handlers don't transform the input, so we merge
			// the submitted partial directly into the cache instead of refetching
			// every field.
			queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( prev ) =>
				prev ? { ...prev, ...partial } : prev
			);
		},
	} );
}
