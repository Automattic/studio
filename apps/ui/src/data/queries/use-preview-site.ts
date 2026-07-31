import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { reportSyncError, reportSyncPending, reportSyncSuccess } from '@/data/sync-activity';
import { finishSyncToast, startSyncToast } from '@/data/sync-toasts';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

// Keyed so other components can tell a preview publish is in flight without
// owning the mutation — the toolbar blocks push and pull on it, but publishes
// previews from a dialog.
export const PUBLISH_PREVIEW_MUTATION_KEY = [ 'publishPreviewSite' ] as const;

// Creates or refreshes the WordPress.com-hosted preview snapshot for a
// local site. Reports lifecycle into the shared sync-activity store so the
// toolbar's status can render the pending / success / error states.
export function usePublishPreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PUBLISH_PREVIEW_MUTATION_KEY,
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'preview' );
			startSyncToast( siteId, 'preview' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'preview' );
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			finishSyncToast( siteId, { intent: 'success', title: __( 'Preview site published' ) } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'preview', message );
			finishSyncToast( siteId, {
				intent: 'error',
				title: __( 'Failed to publish preview site' ),
				description: message,
			} );
		},
	} );
}
