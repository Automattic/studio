import { QueryClient } from '@tanstack/react-query';

// Minimal client for the assistant tab. Session transcripts are persisted on
// disk by the CLI, so we don't mirror the React Query cache to localStorage.
// `useAgentRun` mutates this cache
// during a live run and invalidates explicitly on `run.exited`, so implicit
// refetches stay off to avoid racing those writes.
export const queryClient = new QueryClient( {
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
			retry: false,
		},
	},
} );
