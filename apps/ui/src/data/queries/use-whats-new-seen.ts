import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';

// App version the announcements were last dismissed on — the same value the
// classic renderer reads and writes, so dismissing in one UI settles both.
export const LAST_SEEN_VERSION_QUERY_KEY = [ 'whats-new-last-seen-version' ] as const;

// Browser targets (`studio ui`, hosted) have no app version to record, so they
// record a fixed stand-in. Known trade-off: because a later release stores the
// same value, a browser only ever sees the announcements once. Fixing that needs
// a marker that tracks the content rather than the app version, which would also
// replace FORCE_SHOW_WHATS_NEW — worth doing, but not in this PR.
const BROWSER_VERSION = 'browser';

// The version both the comparison and the write should use. Undefined until the
// app globals have loaded — falling back to BROWSER_VERSION early would let the
// desktop app record 'browser' as the seen marker.
export function useWhatsNewVersion(): string | undefined {
	const { data: appGlobals } = useAppGlobals();
	if ( ! appGlobals ) {
		return undefined;
	}
	return appGlobals.appVersion ?? BROWSER_VERSION;
}

export function useLastSeenVersion() {
	const connector = useConnector();
	return useQuery( {
		queryKey: LAST_SEEN_VERSION_QUERY_KEY,
		queryFn: async () => ( await connector.getLastSeenVersion() ) ?? null,
		staleTime: Infinity,
		meta: { persist: false },
	} );
}

export function useSaveLastSeenVersion() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( version: string ) => connector.saveLastSeenVersion( version ),
		// Optimistic so a second guard sees the write immediately; the connector
		// is the source of truth on next launch.
		onMutate: ( version ) => {
			queryClient.setQueryData( LAST_SEEN_VERSION_QUERY_KEY, version );
		},
	} );
}
