import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient( {
	defaultOptions: {
		queries: {
			networkMode: 'always',
			retry: false,
			refetchOnWindowFocus: false,
		},
		mutations: {
			networkMode: 'always',
		},
	},
} );
