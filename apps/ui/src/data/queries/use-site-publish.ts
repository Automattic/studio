import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { reportSyncError, reportSyncPending, reportSyncSuccess } from '@/data/sync-activity';

// Exported so other mutation hooks (e.g. a future pull) and the sync-activity
// indicator can line up on the same keys when filtering the mutation cache.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

type PublishPreviewVariables = {
	siteId: string;
	existingHostname?: string;
};

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

type PushToLiveVariables = {
	siteId: string;
	remoteSiteId: number;
};

export function usePushSiteToLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId }: PushToLiveVariables ) =>
			connector.pushSiteToLive( siteId, remoteSiteId ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'push' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'push' );
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'push', message );
		},
	} );
}

type PullFromLiveVariables = {
	siteId: string;
	remoteSiteId: number;
};

export function usePullSiteFromLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId }: PullFromLiveVariables ) =>
			connector.pullSiteFromLive( siteId, remoteSiteId ),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'pull' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'pull' );
			// The CLI may have stopped/started the server during the import,
			// and the site's database + themes just changed — refresh the
			// site list so any downstream consumers see the new state.
			void queryClient.invalidateQueries( { queryKey: [ 'sites' ] } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'pull', message );
		},
	} );
}
