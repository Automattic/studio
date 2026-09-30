import { useMutation } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { getFailedActivity, useSettleSync } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

export function usePublishPreviewSite() {
	const connector = useConnector();
	const settleSync = useSettleSync();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'preview' } );
		},
		onError: ( error, { siteId } ) => settleSync( siteId, getFailedActivity( error, 'preview' ) ),
	} );
}
