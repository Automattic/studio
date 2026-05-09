import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { DeskConfig } from '@/data/core';

export const USER_DESK_CONFIG_QUERY_KEY = [ 'desk-config', 'user' ] as const;
export const siteDeskConfigQueryKey = ( siteId: string ) =>
	[ 'desk-config', 'site', siteId ] as const;
export const deskConfigQueryKey = ( siteId?: string ) =>
	siteId ? siteDeskConfigQueryKey( siteId ) : USER_DESK_CONFIG_QUERY_KEY;

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

export function useDeskConfig( siteId?: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: deskConfigQueryKey( siteId ),
		queryFn: () =>
			siteId ? connector.getSiteDeskConfig( siteId ) : connector.getUserDeskConfig(),
	} );
}

export function useSaveDeskConfig( siteId?: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( config: DeskConfig ) =>
			( siteId
				? connector.saveSiteDeskConfig( siteId, config )
				: connector.saveUserDeskConfig( config )
			).then( () => config ),
		onSuccess: ( config ) => {
			queryClient.setQueryData( deskConfigQueryKey( siteId ), config );
		},
	} );
}

export function useSiteDeskConfig( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: siteDeskConfigQueryKey( siteId ),
		queryFn: () => connector.getSiteDeskConfig( siteId ),
	} );
}

export function useSaveSiteDeskConfig( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( config: DeskConfig ) =>
			connector.saveSiteDeskConfig( siteId, config ).then( () => config ),
		onSuccess: ( config ) => {
			queryClient.setQueryData( siteDeskConfigQueryKey( siteId ), config );
		},
	} );
}
