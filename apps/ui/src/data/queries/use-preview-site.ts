import { useMutation } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useSettleFromMutation } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

export function usePublishPreviewSite() {
	const connector = useConnector();
	const settleFromMutation = useSettleFromMutation();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname ),
		onMutate: ( { siteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'preview' } );
		},
		onSuccess: ( _result, { siteId } ) => settleFromMutation( siteId, 'preview' ),
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'preview', error ),
	} );
}
