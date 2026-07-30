import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from './use-sites';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';

export interface ImportSiteInput {
	siteId: string;
	backupPath: string;
	onProgress?: ( event: ImportEventTuple ) => void;
}

/**
 * Runs a backup import against a site that has just been created. The
 * The cached site list is invalidated so metadata changed by the importer is
 * picked up.
 */
export function useImportSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation< void, Error, ImportSiteInput >( {
		mutationFn: ( { siteId, backupPath, onProgress } ) =>
			connector.importSiteFromBackup( siteId, backupPath, onProgress ),
		onSuccess: async () => {
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			toast.success( __( 'Import finished' ) );
		},
	} );
}
