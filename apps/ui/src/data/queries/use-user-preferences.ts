import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { PreferenceChangeSource, UserPreferences, WritableUserPreferences } from '@/data/core';

export const USER_PREFERENCES_QUERY_KEY = [ 'user-preferences' ] as const;

// No staleTime override: preferences can change outside this renderer (the
// Desktop app and `studio ui` share the same config), so the persisted cache paints instantly
// and a mount/focus refetch reconciles it. Settings save on change, so a
// background refetch can't wipe in-progress edits.
export function useUserPreferences() {
	const connector = useConnector();
	return useQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => connector.getUserPreferences(),
	} );
}

type PreferencesPatch = Partial< WritableUserPreferences > & { source?: PreferenceChangeSource };

export function useSaveUserPreferences() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		// `source` is Tracks-only metadata, split out so it never lands in the patch.
		mutationFn: ( { source, ...partial }: PreferencesPatch ) =>
			connector.setUserPreferences( partial, source ).then( () => partial ),
		// Applied before the write, so an older save landing can't undo a newer
		// one (a slider stepped from the keyboard). The CLI toggle waits for its
		// real state instead (see below).
		onMutate: async ( { source: _source, ...partial }: PreferencesPatch ) => {
			// Cancelled first: a fetch still in flight would revert or overwrite
			// the patch when it settles.
			await queryClient.cancelQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );
			const previous = queryClient.getQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY );
			if ( ! previous || 'studioCliInstalled' in partial ) {
				return undefined;
			}
			queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, {
				...previous,
				...partial,
			} );
			return { previous };
		},
		onError: ( _error, { source: _source, ...partial }, context ) => {
			if ( ! context ) {
				return;
			}
			const restored = Object.fromEntries(
				Object.keys( partial ).map( ( key ) => [
					key,
					context.previous[ key as keyof UserPreferences ],
				] )
			);
			queryClient.setQueryData< UserPreferences >( USER_PREFERENCES_QUERY_KEY, ( current ) =>
				current ? { ...current, ...restored } : current
			);
		},
		onSuccess: async ( partial, _variables, context ) => {
			if ( 'browser' in partial ) {
				await queryClient.invalidateQueries( { queryKey: [ 'browser-info' ] } );
			}
			// A fetch that started during the save may have read the preferences
			// before it landed; cancel it so its result can't overwrite the save.
			await queryClient.cancelQueries( { queryKey: USER_PREFERENCES_QUERY_KEY } );
			if ( context ) {
				return;
			}
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
