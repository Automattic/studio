import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { ColorScheme } from '@/data/core';

export const COLOR_SCHEME_QUERY_KEY = [ 'color-scheme' ] as const;

export function useColorScheme() {
	const connector = useConnector();
	return useQuery( {
		queryKey: COLOR_SCHEME_QUERY_KEY,
		queryFn: () => connector.getColorScheme(),
	} );
}

export function useSaveColorScheme() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( scheme: ColorScheme ) => connector.saveColorScheme( scheme ),
		onSuccess: ( _data, scheme ) => {
			queryClient.setQueryData( COLOR_SCHEME_QUERY_KEY, scheme );
		},
	} );
}
