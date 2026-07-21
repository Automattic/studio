import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { UserPreferences, WritableUserPreferences } from '@/data/core';

export const USER_PREFERENCES_QUERY_KEY = [ 'user-preferences' ] as const;

// No staleTime override: preferences can change outside this renderer (the
// legacy UI writes the same config), so the persisted cache paints instantly
// and a mount/focus refetch reconciles it. Settings save on change, so a
// background refetch can't wipe in-progress edits.
export function useUserPreferences() {
	const connector = useConnector();
	return useQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => connector.getUserPreferences(),
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
