import { useMutation } from '@tanstack/react-query';
import { getAccountJourney, completeAccountJourney } from '@/data/account-analytics';
import { useConnector } from '@/data/core';
import { useSettleFromMutation } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
	name?: string;
};

export function usePublishPreviewSite() {
	const connector = useConnector();
	const settleFromMutation = useSettleFromMutation();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname, name }: PublishPreviewVariables ) =>
			connector.publishPreviewSite( siteId, existingHostname, name ),
		onMutate: ( { siteId, existingHostname } ) => {
			applySyncActivity( siteId, {
				kind: 'pending',
				direction: 'preview',
				hostname: existingHostname,
			} );
			return (
				getAccountJourney( connector, 'share', siteId ) ?? getAccountJourney( connector, 'share' )
			);
		},
		onSuccess: ( _result, { siteId, existingHostname }, journey ) => {
			settleFromMutation( siteId, 'preview' );
			completeAccountJourney( connector, journey, {
				completion_kind: existingHostname ? 'preview_update' : 'preview_create',
			} );
		},
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'preview', error ),
	} );
}
