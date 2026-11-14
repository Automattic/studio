import { getEditedDefaultThemesWarning } from '@studio/common/lib/snapshots';
import { useMutation } from '@tanstack/react-query';
import { getAccountJourney, completeAccountJourney } from '@/data/account-analytics';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useSettleSync, useSettleFromMutation } from '@/data/queries/use-sync-site';

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
	name?: string;
	liveSite?: string;
};

export function usePublishPreviewSite() {
	const connector = useConnector();
	const settleFromMutation = useSettleFromMutation();
	const recordActivity = useSettleSync();
	return useMutation( {
		mutationFn: ( { siteId, existingHostname, name, liveSite }: PublishPreviewVariables ) =>
			connector.publishPreviewSite(
				siteId,
				existingHostname,
				name,
				...( liveSite !== undefined ? [ liveSite ] : [] )
			),
		onMutate: ( { siteId, existingHostname } ) => {
			recordActivity( siteId, {
				kind: 'pending',
				direction: 'preview',
				hostname: existingHostname,
			} );
			return (
				getAccountJourney( connector, 'share', siteId ) ?? getAccountJourney( connector, 'share' )
			);
		},
		onSuccess: ( result, { siteId, existingHostname }, journey ) => {
			settleFromMutation( siteId, 'preview' );
			if ( result.editedThemes?.length ) {
				toast.warning( getEditedDefaultThemesWarning( result.editedThemes ) );
			}
			completeAccountJourney( connector, journey, {
				completion_kind: existingHostname ? 'preview_update' : 'preview_create',
			} );
		},
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'preview', error ),
	} );
}
