import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { buildSyncEventProps } from '@studio/common/lib/sync/build-sync-event-props';
import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import {
	reportPushPhase,
	reportSyncCancelled,
	reportSyncError,
	reportSyncPending,
	reportSyncProgress,
	reportSyncSuccess,
} from '@/data/sync-activity';
import type { PullSiteProgress, PullSyncOptions, PushSyncOptions } from '@/data/core';
import type { SyncSite } from '@studio/common/types/sync';

// Mutation keys are exported so downstream consumers (e.g. a cross-page
// activity indicator or future bulk-sync UI) can filter the react-query
// mutation cache for in-flight push/pull operations by site.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

// `onMutate`'s return value, handed back to `onSuccess`/`onError` by react-query.
type SyncTracksContext = { startedAt: number };

// Reads the connected site out of the query cache to derive the `sync_type`
// Tracks prop. Cache-only so telemetry never costs a request; an unpopulated
// cache reports `unknown` rather than guessing.
function useFindConnectedSite() {
	const queryClient = useQueryClient();
	return ( localSiteId: string, remoteSiteId: number ): SyncSite | undefined =>
		queryClient
			.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( localSiteId ) )
			?.find( ( site ) => site.id === remoteSiteId );
}

type PushToLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	options?: PushSyncOptions;
};

export function usePushSiteToLive() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const findConnectedSite = useFindConnectedSite();
	return useMutation( {
		mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options }: PushToLiveVariables ) =>
			connector.pushSiteToLive( siteId, remoteSiteId, options, ( phase, progress ) =>
				reportPushPhase( siteId, phase, progress )
			),
		onMutate: ( { siteId } ): SyncTracksContext => {
			reportSyncPending( siteId, 'push' );
			return { startedAt: Date.now() };
		},
		onSuccess: ( _result, { siteId, remoteSiteId }, context ) => {
			reportSyncSuccess( siteId, 'push' );
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( siteId ),
			} );
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PUSH,
				buildSyncEventProps( {
					startedAt: context.startedAt,
					site: findConnectedSite( siteId, remoteSiteId ),
				} )
			);
			toast.success( __( 'Push complete' ) );
		},
		onError: ( error, { siteId, remoteSiteId }, context ) => {
			if ( isSyncCancelledError( error ) ) {
				reportSyncCancelled( siteId, 'push' );
				toast.success( __( 'Push cancelled' ) );
				return;
			}
			const message = error instanceof Error ? error.message : String( error );
			reportSyncError( siteId, 'push', message );
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PUSH,
				buildSyncEventProps( {
					startedAt: context?.startedAt ?? Date.now(),
					site: findConnectedSite( siteId, remoteSiteId ),
					error,
				} )
			);
			toast.error( __( "Push didn't complete" ) );
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

type CancelSyncVariables = {
	siteId: string;
	remoteSiteId: number;
};

export function useCancelSync() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: ( { siteId, remoteSiteId }: CancelSyncVariables ) =>
			connector.cancelSync( siteId, remoteSiteId ),
		onError: ( error ) => {
			console.error( 'Failed to cancel sync:', error );
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
	const findConnectedSite = useFindConnectedSite();
	return useMutation( {
		mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, onProgress, options }: PullFromLiveVariables ) =>
			connector.pullSiteFromLive(
				siteId,
				remoteSiteId,
				( progress ) => {
					reportSyncProgress( siteId, 'pull', progress );
					onProgress?.( progress );
				},
				options
			),
		onMutate: ( { siteId } ): SyncTracksContext => {
			reportSyncPending( siteId, 'pull' );
			return { startedAt: Date.now() };
		},
		onSuccess: ( _result, { siteId, remoteSiteId }, context ) => {
			reportSyncSuccess( siteId, 'pull' );
			// The CLI may have stopped/started the server during the import,
			// and the site's database + themes just changed — refresh the
			// site list so any downstream consumers see the new state.
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PULL,
				buildSyncEventProps( {
					startedAt: context.startedAt,
					site: findConnectedSite( siteId, remoteSiteId ),
				} )
			);
			toast.success( __( 'Pull complete' ) );
		},
		onError: ( _error, { siteId, remoteSiteId }, context ) => {
			if ( isSyncCancelledError( _error ) ) {
				reportSyncCancelled( siteId, 'pull' );
				// The CLI restarts the site server on its way out, so the local
				// site may have been stopped and started again.
				void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
				toast.success( __( 'Pull cancelled' ) );
				return;
			}
			// Only point at the logs where the user can actually open them.
			const canOpenLogs = connector.capabilities.studioLogs;
			const message = canOpenLogs
				? __(
						"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details."
				  )
				: __( "Studio couldn't copy the live site. Try again." );
			reportSyncError( siteId, 'pull', message );
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PULL,
				buildSyncEventProps( {
					startedAt: context?.startedAt ?? Date.now(),
					site: findConnectedSite( siteId, remoteSiteId ),
					// Classify the raw error — `message` above is translated display text.
					error: _error,
				} )
			);
			toast.error( __( "Pull didn't complete" ), {
				description: message,
				action: canOpenLogs
					? {
							label: __( 'Open Studio Logs' ),
							onClick: () => {
								void connector.openStudioLogs().catch( ( error ) => {
									console.error( 'Failed to open Studio logs:', error );
								} );
							},
					  }
					: undefined,
			} );
		},
	} );
}
