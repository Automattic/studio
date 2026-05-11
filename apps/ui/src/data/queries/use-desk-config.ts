import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { DeskConfig } from '@/data/core';

const userDeskConfigQueryKey = [ 'desk-config', 'user' ] as const;
const siteDeskConfigQueryKey = ( siteId: string ) => [ 'desk-config', 'site', siteId ] as const;
const deskConfigQueryKey = ( siteId?: string ) =>
	siteId ? siteDeskConfigQueryKey( siteId ) : userDeskConfigQueryKey;

export function useDeskConfig( siteId?: string, enabled = true ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: deskConfigQueryKey( siteId ),
		queryFn: () =>
			siteId ? connector.getSiteDeskConfig( siteId ) : connector.getUserDeskConfig(),
		enabled,
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
