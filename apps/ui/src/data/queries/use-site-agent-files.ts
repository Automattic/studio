import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteAgentFileKind } from '@/data/core';

export const SITE_AGENT_FILES_QUERY_KEY = [ 'site-agent-files' ] as const;

export function useSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, kind ],
		queryFn: () => connector.getSiteAgentFiles( siteId, kind ),
	} );
}

// Switches files on or off, or uninstalls one, then re-reads the site.
export function useUpdateSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async (
			change: { ids: string[]; enabled: boolean } | { remove: string }
		): Promise< void > => {
			if ( 'remove' in change ) {
				await connector.removeSiteAgentFile( siteId, kind, change.remove );
				return;
			}
			for ( const id of change.ids ) {
				await connector.setSiteAgentFileEnabled( siteId, kind, id, change.enabled );
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries( {
				queryKey: [ ...SITE_AGENT_FILES_QUERY_KEY, siteId, kind ],
			} ),
	} );
}
