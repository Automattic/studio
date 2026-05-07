import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { DeskConfig } from '@/data/core';

export const USER_DESK_CONFIG_QUERY_KEY = [ 'desk-config', 'user' ] as const;

export function useUserDeskConfig() {
	const connector = useConnector();
	return useQuery( {
		queryKey: USER_DESK_CONFIG_QUERY_KEY,
		queryFn: () => connector.getUserDeskConfig(),
	} );
}

export function useSaveUserDeskConfig() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( config: DeskConfig ) =>
			connector.saveUserDeskConfig( config ).then( () => config ),
		onSuccess: ( config ) => {
			queryClient.setQueryData( USER_DESK_CONFIG_QUERY_KEY, config );
		},
	} );
}
