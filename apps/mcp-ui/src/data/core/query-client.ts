import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient( {
	defaultOptions: {
		queries: {
			networkMode: 'always',
			retry: false,
			// As in apps/ui, coming back to the library refreshes it; each read is a
			// round trip through the host, so a list stays fresh for a few seconds.
			refetchOnWindowFocus: true,
			staleTime: 10_000,
		},
		mutations: {
			networkMode: 'always',
		},
	},
} );
