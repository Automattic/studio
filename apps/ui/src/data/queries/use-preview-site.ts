import { useMutation } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
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
			toast.processing( existingHostname ? __( 'Updating preview…' ) : __( 'Creating preview…' ), {
				id: `preview-${ siteId }`,
			} );
			applySyncActivity( siteId, {
				kind: 'pending',
				direction: 'preview',
				hostname: existingHostname,
			} );
		},
		onSuccess: ( _result, { siteId } ) => settleFromMutation( siteId, 'preview' ),
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'preview', error ),
	} );
}
