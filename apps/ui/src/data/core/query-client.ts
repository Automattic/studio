import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

export const queryClient = new QueryClient( {
	defaultOptions: {
		queries: {
			// Data access goes through the connector (local IPC on desktop), so
			// don't let React Query pause work while `navigator.onLine` is false —
			// paused fetches hang route beforeLoads and freeze all navigation.
			networkMode: 'always',
			staleTime: 0,
			refetchOnWindowFocus: true,
			refetchOnMount: true,
			retry: ( failureCount: number, error: Error ) => {
				if ( 'status' in error && typeof error.status === 'number' ) {
					if ( error.status >= 400 && error.status < 500 ) {
						return false;
					}
				}
				return failureCount < 3;
			},
		},
		mutations: {
			networkMode: 'always',
		},
	},
} );

export const SESSIONS_QUERY_KEY = [ 'sessions' ] as const;

// Chat transcripts hold screenshots and attachments, and the persister serializes the
// whole cache on every change: a large one ran the renderer out of memory. They load
// from the session files instead.
function isSessionTranscript( queryKey: readonly unknown[] ): boolean {
	return queryKey.length > SESSIONS_QUERY_KEY.length && queryKey[ 0 ] === SESSIONS_QUERY_KEY[ 0 ];
}

export const persister = createSyncStoragePersister( {
	storage: window.localStorage,
} );

const maxAge = 1000 * 60 * 60 * 24;

const [ , persistPromise ] = persistQueryClient( {
	queryClient,
	persister,
	buster: '7', // Bump when query data shape changes.
	maxAge,
	dehydrateOptions: {
		shouldRedactErrors: () => false,
		shouldDehydrateQuery: ( query ) => {
			if ( query.meta?.persist === false || isSessionTranscript( query.queryKey ) ) {
				return false;
			}
			return defaultShouldDehydrateQuery( query );
		},
	},
} );

export { persistPromise };
