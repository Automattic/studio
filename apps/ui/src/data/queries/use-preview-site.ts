import { useMutation } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useSettleSync } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

// Creates or refreshes the WordPress.com-hosted preview snapshot for a local
// site. The CLI publishes its progress and result as sync activity.
export function usePublishPreviewSite() {
	const connector = useConnector();
	const settleSync = useSettleSync();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'preview' } );
		},
		onError: ( error, { siteId } ) => {
			settleSync( siteId, {
				kind: 'error',
				direction: 'preview',
				message: error instanceof Error ? error.message : String( error ),
			} );
		},
	} );
}
