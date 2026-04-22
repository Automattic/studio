import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { reportSyncError, reportSyncPending, reportSyncSuccess } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

// Creates or refreshes the WordPress.com-hosted preview snapshot for a
// local site. Reports lifecycle into the shared sync-activity store so the
// site-dropdown indicator can render the pending / success / error states.
export function usePublishPreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'preview' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'preview' );
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'preview', message );
		},
	} );
}
