import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from './use-sites';
import type { SiteDetails } from '@/data/core';

export interface ImportSiteInput {
	siteId: string;
	backup: { path: string; type: string };
}

/**
 * Runs a backup import against a site that has just been created. The
 * connector stops the site, extracts the archive, imports its database +
 * wp-content, then starts the site back up. The cached site list is
 * invalidated so the updated `running` / `phpVersion` state is picked up.
 */
export function useImportSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation< SiteDetails, Error, ImportSiteInput >( {
		mutationFn: ( { siteId, backup } ) => connector.importSiteFromBackup( siteId, backup ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}
