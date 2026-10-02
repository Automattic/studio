import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector, type Library } from '@/data/core';
import { useHostState } from '@/hooks/use-host-state';

export const LIBRARY_QUERY_KEY = [ 'library' ] as const;
export const EMPTY_LIBRARY: Library = {
	localSites: [],
	wpcom: { signedIn: false, sites: [], error: '' },
};
const HOST_RESULT_GRACE_MS = 1500;

export function useLibrary() {
	const connector = useConnector();
	return useQuery( {
		queryKey: LIBRARY_QUERY_KEY,
		queryFn: () => connector.readLibrary(),
		enabled: false,
	} );
}

// The host pushes the tool result that opened the library; when it opened it
// without one (a sidebar entry or a restored tab), read the library directly.
export function useSyncLibraryWithHost() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { status } = useHostState();

	useEffect(
		() =>
			connector.onLibraryResult( ( read ) => {
				void queryClient
					.fetchQuery( { queryKey: LIBRARY_QUERY_KEY, queryFn: async () => read() } )
					.catch( () => undefined );
			} ),
		[ connector, queryClient ]
	);

	useEffect( () => {
		if ( status !== 'ready' ) {
			return;
		}
		const timer = setTimeout( () => {
			const query = queryClient.getQueryState( LIBRARY_QUERY_KEY );
			if ( ! query || ( query.status === 'pending' && query.fetchStatus === 'idle' ) ) {
				void queryClient
					.fetchQuery( { queryKey: LIBRARY_QUERY_KEY, queryFn: () => connector.readLibrary() } )
					.catch( () => undefined );
			}
		}, HOST_RESULT_GRACE_MS );
		return () => clearTimeout( timer );
	}, [ status, connector, queryClient ] );
}
