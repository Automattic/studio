import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from './use-sites';

export interface ImportSiteInput {
	siteId: string;
	backup: { path: string; type: string };
}

/**
 * Runs a backup import against a site that has just been created. The
 * connector extracts the archive and imports its database + wp-content
 * into the site's folder. The cached site list is invalidated so the
 * updated `phpVersion` (which the importer may overwrite from the backup's
 * meta) is picked up.
 */
export function useImportSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation< void, Error, ImportSiteInput >( {
		mutationFn: ( { siteId, backup } ) => connector.importSiteFromBackup( siteId, backup ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}
