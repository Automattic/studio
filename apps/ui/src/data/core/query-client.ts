import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { focusManager, QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

// TanStack Query v5 only watches `visibilitychange`, which never fires in an
// Electron BrowserWindow when the app loses focus — the document stays
// visible, so `refetchOnWindowFocus` never triggers in the desktop shell.
// Watch window focus/blur as well (the listener v5 dropped to avoid
// overfetching in browsers), matching browser-tab behavior. The classic
// renderer doesn't need this because RTK Query's `setupListeners` still
// subscribes to both `focus` and `visibilitychange`.
if ( typeof window !== 'undefined' ) {
	focusManager.setEventListener( ( handleFocus ) => {
		const onFocus = () => handleFocus( true );
		const onBlur = () => handleFocus( false );
		const onVisibilityChange = () => handleFocus( document.visibilityState === 'visible' );
		window.addEventListener( 'focus', onFocus );
		window.addEventListener( 'blur', onBlur );
		document.addEventListener( 'visibilitychange', onVisibilityChange );
		return () => {
			window.removeEventListener( 'focus', onFocus );
			window.removeEventListener( 'blur', onBlur );
			document.removeEventListener( 'visibilitychange', onVisibilityChange );
		};
	} );
}

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

export const persister = createSyncStoragePersister( {
	storage: typeof window !== 'undefined' ? window.localStorage : null,
} );

const maxAge = 1000 * 60 * 60 * 24; // 24 hours

const [ , persistPromise ] = persistQueryClient( {
	queryClient,
	persister,
	buster: '4', // Bump when query data shape changes.
	maxAge,
	dehydrateOptions: {
		shouldRedactErrors: () => false,
		shouldDehydrateQuery: ( query ) => {
			if ( query.meta?.persist === false ) {
				return false;
			}
			return defaultShouldDehydrateQuery( query );
		},
	},
} );

export { persistPromise };
