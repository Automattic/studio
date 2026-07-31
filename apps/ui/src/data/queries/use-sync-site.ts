import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import {
	reportPullProgress,
	reportPushProgress,
	reportSyncError,
	reportSyncPending,
	reportSyncSuccess,
} from '@/data/sync-activity';
import {
	finishSyncToast,
	startSyncToast,
	updatePullToast,
	updatePushToast,
} from '@/data/sync-toasts';
import type { PullSiteProgress, PullSyncOptions, PushSyncOptions } from '@/data/core';

// Mutation keys are exported so downstream consumers (e.g. a cross-page
// activity indicator or future bulk-sync UI) can filter the react-query
// mutation cache for in-flight push/pull operations by site.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

type PushToLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	options?: PushSyncOptions;
};

export function usePushSiteToLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options }: PushToLiveVariables ) =>
			connector.pushSiteToLive(
				siteId,
				remoteSiteId,
				( progress ) => {
					reportPushProgress( siteId, progress );
					updatePushToast( siteId, progress );
				},
				options
			),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'push' );
			startSyncToast( siteId, 'push' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'push' );
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
			finishSyncToast( siteId, { intent: 'success', title: __( 'Push complete' ) } );
		},
		onError: ( error, { siteId } ) => {
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'push', message );
			finishSyncToast( siteId, {
				intent: 'error',
				title: __( "Push didn't complete" ),
				description: message,
			} );
		},
	} );
}

type DisconnectWpcomSiteVariables = {
	siteId: string;
	remoteSiteId: number;
};

export function useDisconnectWpcomSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, remoteSiteId }: DisconnectWpcomSiteVariables ) =>
			connector.disconnectWpcomSite( siteId, remoteSiteId ),
		onSuccess: ( _result, { siteId } ) => {
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
		},
	} );
}

type PullFromLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	onProgress?: ( progress: PullSiteProgress ) => void;
	options?: PullSyncOptions;
};

export function usePullSiteFromLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, onProgress, options }: PullFromLiveVariables ) =>
			connector.pullSiteFromLive(
				siteId,
				remoteSiteId,
				( progress ) => {
					reportPullProgress( siteId, progress );
					updatePullToast( siteId, progress );
					onProgress?.( progress );
				},
				options
			),
		onMutate: ( { siteId } ) => {
			reportSyncPending( siteId, 'pull' );
			startSyncToast( siteId, 'pull' );
		},
		onSuccess: ( _result, { siteId } ) => {
			reportSyncSuccess( siteId, 'pull' );
			// The CLI may have stopped/started the server during the import,
			// and the site's database + themes just changed — refresh the
			// site list so any downstream consumers see the new state.
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			finishSyncToast( siteId, { intent: 'success', title: __( 'Pull complete' ) } );
		},
		onError: ( _error, { siteId } ) => {
			const message = __(
				"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details."
			);
			reportSyncError( siteId, 'pull', message );
			finishSyncToast( siteId, {
				intent: 'error',
				title: __( "Pull didn't complete" ),
				description: message,
			} );
		},
	} );
}
