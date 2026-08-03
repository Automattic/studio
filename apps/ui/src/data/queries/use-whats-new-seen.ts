import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

// App version the announcements were last dismissed on — the same value the
// classic renderer reads and writes, so dismissing in one UI settles both.
export const LAST_SEEN_VERSION_QUERY_KEY = [ 'whats-new-last-seen-version' ] as const;

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
