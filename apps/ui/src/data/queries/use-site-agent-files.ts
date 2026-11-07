import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const SITE_AGENT_FILES_QUERY_KEY = [ 'site-agent-files' ] as const;

export function useSiteAgentFiles( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId ],
		queryFn: () => connector.getSiteAgentFiles( siteId ),
	} );
}

// Switches files on or off, or uninstalls one, then re-reads the site.
export function useUpdateSiteAgentFiles( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async (
			change: { ids: string[]; enabled: boolean } | { remove: string }
		): Promise< void > => {
			if ( 'remove' in change ) {
				await connector.removeSiteAgentFile( siteId, change.remove );
				return;
			}
			for ( const id of change.ids ) {
				await connector.setSiteAgentFileEnabled( siteId, id, change.enabled );
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries( {
				queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId ],
			} ),
	} );
}
