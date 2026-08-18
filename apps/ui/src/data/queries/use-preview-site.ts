import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { reportSyncError, reportSyncPending, reportSyncSuccess } from '@/data/sync-activity';
import { finishSyncToast, startSyncToast } from '@/data/sync-toasts';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

// Creates or refreshes the WordPress.com-hosted preview snapshot for a
// local site. Reports lifecycle into the shared sync-activity store so
// sync-activity consumers can render the pending / success / error states.
export function usePublishPreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'preview' );
			startSyncToast( siteId, 'preview' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'preview' );
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			finishSyncToast( siteId, { intent: 'success', title: __( 'Preview link published' ) } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'preview', message );
			finishSyncToast( siteId, { intent: 'error', title: __( 'Failed to publish preview link' ) } );
		},
	} );
}

// Deletes a single WordPress.com-hosted preview by its hostname and refreshes
// the snapshot list.
export function useDeletePreviewSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { hostname }: { hostname: string } ) => connector.deletePreviewSite( hostname ),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
		},
		onError: ( error ) => {
			const message = error instanceof Error ? error.message : String( error );
			toast.error( message || __( 'Failed to delete preview link' ) );
		},
	} );
}
