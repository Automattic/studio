import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { spacefastConnectionQueryKey } from '@/data/queries/use-spacefast';
import { useSettleFromMutation } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';
import type { SpacefastPublishTarget } from '@/data/core';

// `studio spacefast publish` reports its progress and outcome as sync activity; the
// mutation only marks it pending and settles it if the CLI never got to.
export function usePublishToSpacefast() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const settleFromMutation = useSettleFromMutation();
	return useMutation( {
		mutationFn: ( { siteId, target }: { siteId: string; target: SpacefastPublishTarget } ) =>
			connector.publishToSpacefast( siteId, target ),
		onMutate: ( { siteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'spacefast' } );
		},
		onSuccess: ( connection, { siteId } ) => {
			queryClient.setQueryData( spacefastConnectionQueryKey( siteId ), connection );
			settleFromMutation( siteId, 'spacefast' );
			void connector.openExternalUrl( connection.liveUrl );
		},
		onError: ( error, { siteId } ) => settleFromMutation( siteId, 'spacefast', error ),
	} );
}
