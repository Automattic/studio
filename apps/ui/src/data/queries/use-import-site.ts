import { useMutation } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useSettleFromMutation } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';

interface ImportSiteInput {
	siteId: string;
	backupPath: string;
	suppressTracksEvent?: boolean;
}

// Imports a backup over an existing site, whether it was just created by the
// import flow or has been around. The CLI publishes its progress and result as
// sync activity, which refreshes everything the import changed.
export function useImportSite() {
	const connector = useConnector();
	const settleFromMutation = useSettleFromMutation();
	return useMutation< void, Error, ImportSiteInput >( {
		mutationFn: ( { siteId, backupPath, suppressTracksEvent } ) =>
			connector.importSiteFromBackup( siteId, backupPath, { suppressTracksEvent } ),
		onMutate: ( { siteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'import' } );
		},
		onSuccess: ( _result, { siteId } ) => settleFromMutation( siteId, 'import' ),
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'import', error ),
	} );
}
