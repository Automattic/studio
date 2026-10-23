import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { PreferenceChangeSource, UserPreferences, WritableUserPreferences } from '@/data/core';

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
		// `source` is Tracks-only metadata, split out so it never lands in the patch.
		mutationFn: ( {
			source,
			...partial
		}: Partial< WritableUserPreferences > & { source?: PreferenceChangeSource } ) =>
			connector.setUserPreferences( partial, source ).then( () => partial ),
		onSuccess: async ( partial ) => {
			// A fetch still in flight may have read the preferences before this
			// save landed; cancel it so its result can't overwrite the save.
			await queryClient.cancelQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );

			// Main-process save handlers don't transform the input, so we merge
			// the submitted partial directly into the cache instead of refetching
			// every field.
			const prev = queryClient.getQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY );
			if ( prev ) {
				queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, {
					...prev,
					...partial,
				} );
			}
			// Refetch when there was nothing to merge into, and for the CLI toggle:
			// install/uninstall can be declined or fail behind a native
			// main-process dialog while the IPC call still resolves. Returning the
			// promise keeps the mutation pending until the real state lands.
			if ( ! prev || 'studioCliInstalled' in partial ) {
				return queryClient.invalidateQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );
			}
		},
	} );
}
