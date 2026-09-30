import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { buildSyncEventProps } from '@studio/common/lib/sync/build-sync-event-props';
import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { applySyncActivity } from '@/data/sync-activity';
import type { PullSyncOptions, PushSyncOptions } from '@/data/core';
import type { SyncActivity } from '@studio/common/lib/sync/activity';
import type { SyncSite } from '@studio/common/types/sync';

// Mutation keys are exported so downstream consumers (e.g. a cross-page
// activity indicator or future bulk-sync UI) can filter the react-query
// mutation cache for in-flight push/pull operations by site.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

// `onMutate`'s return value, handed back to `onSuccess`/`onError` by react-query.
type SyncTracksContext = { startedAt: number };

// Resolves the connected site behind a sync, to derive the `sync_type` Tracks
// prop. Callers that already hold the remote site pass it as `syncSite` — the
// onboarding flow creates its local site as it goes, so nothing has ever
// populated the cache for it. Otherwise this reads the cache, which costs no
// request; a miss reports `unknown` rather than guessing.
function useFindConnectedSite() {
	const queryClient = useQueryClient();
	return (
		localSiteId: string,
		remoteSiteId: number,
		syncSite?: Pick< SyncSite, 'isPressable' >
	): Pick< SyncSite, 'isPressable' > | undefined =>
		syncSite ??
		queryClient
			.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( localSiteId ) )
			?.find( ( site ) => site.id === remoteSiteId );
}

/**
 * Records a sync's activity and, the first time it settles, announces the result
 * and refreshes what it changed — whichever surface started the sync.
 */
export function useSettleSync() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useCallback(
		( siteId: string, activity: SyncActivity ) => {
			// Only point at the logs where the user can actually open them.
			const canOpenLogs = connector.capabilities.studioLogs;
			const settled =
				activity.kind === 'error' && activity.direction === 'pull'
					? {
							...activity,
							message: canOpenLogs
								? __(
										"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details."
								  )
								: __( "Studio couldn't copy the live site. Try again." ),
					  }
					: activity;
			if ( ! applySyncActivity( siteId, settled ) ) {
				return;
			}

			if ( settled.direction === 'preview' ) {
				void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
				if ( settled.kind === 'success' ) {
					toast.success( __( 'Preview site published' ) );
				} else if ( settled.kind === 'error' ) {
					toast.error( __( 'Failed to publish preview site' ) );
				}
				return;
			}
			if ( settled.direction !== 'push' && settled.direction !== 'pull' ) {
				return;
			}

			void queryClient.invalidateQueries( { queryKey: connectedWpcomSitesQueryKey( siteId ) } );
			// A pull stops and restarts the site and rewrites its content.
			if ( settled.direction === 'pull' ) {
				void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			}
			const isPush = settled.direction === 'push';
			if ( settled.kind === 'success' ) {
				toast.success( isPush ? __( 'Push complete' ) : __( 'Pull complete' ) );
			} else if ( settled.kind === 'cancelled' ) {
				toast.success( isPush ? __( 'Push cancelled' ) : __( 'Pull cancelled' ) );
			} else if ( isPush ) {
				toast.error( __( "Push didn't complete" ) );
			} else {
				toast.error( __( "Pull didn't complete" ), {
					description: settled.message,
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
			}
		},
		[ connector, queryClient ]
	);
}

/** Mirrors the sync activity the CLI publishes into the UI. Mount once near the app root. */
export function useSyncActivityEvents(): void {
	const connector = useConnector();
	const settleSync = useSettleSync();
	useEffect(
		() => connector.onSyncActivity( ( { siteId, activity } ) => settleSync( siteId, activity ) ),
		[ connector, settleSync ]
	);
}

// The CLI reports how a sync ends, but not if it never got to run (it failed to
// start, or was stopped before it could say so). Settling from the mutation too
// covers that; whichever lands second is ignored.
function settleFromError( settleSync: ReturnType< typeof useSettleSync > ) {
	return ( error: unknown, siteId: string, direction: 'push' | 'pull' | 'preview' ) =>
		settleSync(
			siteId,
			isSyncCancelledError( error )
				? { kind: 'cancelled', direction }
				: {
						kind: 'error',
						direction,
						message: error instanceof Error ? error.message : String( error ),
				  }
		);
}

type PushToLiveVariables = {
	siteId: string;
	remoteSiteId: number;
	options?: PushSyncOptions;
	// Supplied by callers whose site isn't in the connected-sites cache yet.
	syncSite?: Pick< SyncSite, 'isPressable' >;
};

export function usePushSiteToLive() {
	const connector = useConnector();
	const findConnectedSite = useFindConnectedSite();
	const settleError = settleFromError( useSettleSync() );
	return useMutation( {
		mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options }: PushToLiveVariables ) =>
			connector.pushSiteToLive( siteId, remoteSiteId, options ),
		onMutate: ( { siteId } ): SyncTracksContext => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'push' } );
			return { startedAt: Date.now() };
		},
		onSuccess: ( _result, { siteId, remoteSiteId, syncSite }, context ) => {
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PUSH,
				buildSyncEventProps( {
					startedAt: context.startedAt,
					site: findConnectedSite( siteId, remoteSiteId, syncSite ),
				} )
			);
		},
		onError: ( error, { siteId, remoteSiteId, syncSite }, context ) => {
			settleError( error, siteId, 'push' );
			if ( isSyncCancelledError( error ) ) {
				return;
			}
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PUSH,
				buildSyncEventProps( {
					startedAt: context?.startedAt ?? Date.now(),
					site: findConnectedSite( siteId, remoteSiteId, syncSite ),
					error,
				} )
			);
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
	options?: PullSyncOptions;
	// Supplied by callers whose site isn't in the connected-sites cache yet.
	syncSite?: Pick< SyncSite, 'isPressable' >;
};

export function usePullSiteFromLive() {
	const connector = useConnector();
	const findConnectedSite = useFindConnectedSite();
	const settleError = settleFromError( useSettleSync() );
	return useMutation( {
		mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options }: PullFromLiveVariables ) =>
			connector.pullSiteFromLive( siteId, remoteSiteId, options ),
		onMutate: ( { siteId } ): SyncTracksContext => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'pull' } );
			return { startedAt: Date.now() };
		},
		onSuccess: ( _result, { siteId, remoteSiteId, syncSite }, context ) => {
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PULL,
				buildSyncEventProps( {
					startedAt: context.startedAt,
					site: findConnectedSite( siteId, remoteSiteId, syncSite ),
				} )
			);
		},
		onError: ( error, { siteId, remoteSiteId, syncSite }, context ) => {
			settleError( error, siteId, 'pull' );
			if ( isSyncCancelledError( error ) ) {
				return;
			}
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_PULL,
				buildSyncEventProps( {
					startedAt: context?.startedAt ?? Date.now(),
					site: findConnectedSite( siteId, remoteSiteId, syncSite ),
					error,
				} )
			);
		},
	} );
}
