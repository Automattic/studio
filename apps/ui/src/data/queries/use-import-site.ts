import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { siteStorageUsageQueryKey } from './use-site-storage-usage';
import { siteThumbnailQueryKey } from './use-site-thumbnail';
import { SITES_QUERY_KEY } from './use-sites';
import { WP_VERSION_QUERY_KEY } from './use-wordpress-versions';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';

export interface ImportSiteInput {
	siteId: string;
	backupPath: string;
	onProgress?: ( event: ImportEventTuple ) => void;
}

// Imports a backup over an existing site, whether it was just created by the
// import flow or has been around. The cached site list is invalidated so
// metadata changed by the importer is picked up.
export function useImportSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation< void, Error, ImportSiteInput >( {
		mutationFn: ( { siteId, backupPath, onProgress } ) =>
			connector.importSiteFromBackup( siteId, backupPath, onProgress ),
		onSuccess: async ( _result, { siteId } ) => {
			// The importer replaces the site's files and database and restarts the
			// server, so everything read off that site is stale. The site list
			// alone isn't enough: disk usage in particular caches for five minutes,
			// and the overview stays mounted, so nothing would refetch it.
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			await Promise.all(
				[
					[ ...WP_VERSION_QUERY_KEY, siteId ],
					siteStorageUsageQueryKey( siteId ),
					siteThumbnailQueryKey( siteId ),
				].map( ( queryKey ) => queryClient.invalidateQueries( { queryKey } ) )
			);
			toast.success( __( 'Import finished' ) );
		},
	} );
}
