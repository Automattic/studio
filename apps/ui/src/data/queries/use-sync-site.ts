import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { buildSyncEventProps } from '@studio/common/lib/sync/build-sync-event-props';
import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { siteStorageUsageQueryKey } from '@/data/queries/use-site-storage-usage';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/use-snapshots';
import { WP_VERSION_QUERY_KEY } from '@/data/queries/use-wordpress-versions';
import { applySyncActivity } from '@/data/sync-activity';
import type { Connector, PullSyncOptions, PushSyncOptions } from '@/data/core';
import type { SyncActivity, SyncDirection } from '@studio/common/lib/sync/activity';
import type { SyncSite } from '@studio/common/types/sync';

// Mutation keys are exported so downstream consumers (e.g. a cross-page
// activity indicator or future bulk-sync UI) can filter the react-query
// mutation cache for in-flight push/pull operations by site.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSiteToLive' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSiteFromLive' ] as const;

// Records a sync's activity and, the first time it settles, announces the result.
export function useSettleSync() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useCallback(
		( siteId: string, activity: SyncActivity ) => {
			// Only point at the logs where the user can actually open them.
			const canOpenLogs = connector.capabilities.studioLogs;
			const plainMessage =
				activity.kind === 'error'
					? getPlainErrorMessage( activity.direction, canOpenLogs )
					: undefined;
			const settled =
				activity.kind === 'error' && plainMessage
					? { ...activity, message: plainMessage }
					: activity;
			if ( ! applySyncActivity( siteId, settled ) ) {
				return;
			}
			if ( activity.kind === 'error' && plainMessage ) {
				console.error( 'Sync activity failed:', activity.direction, activity.message );
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
			if ( settled.direction === 'import' ) {
				// The importer replaces the site's files and database and restarts the
				// server, so everything read off that site is stale — disk usage in
				// particular caches for minutes and nothing else would refetch it.
				for ( const queryKey of [
					SITES_QUERY_KEY,
					[ ...WP_VERSION_QUERY_KEY, siteId ],
					siteStorageUsageQueryKey( siteId ),
					siteThumbnailQueryKey( siteId ),
				] ) {
					void queryClient.invalidateQueries( { queryKey } );
				}
				if ( settled.kind === 'success' ) {
					toast.success( __( 'Import finished' ) );
				} else if ( settled.kind === 'error' ) {
					toast.error( __( "Import didn't complete" ), {
						description: settled.message,
						action: canOpenLogs ? openStudioLogsAction( connector ) : undefined,
					} );
				}
				return;
			}

			void queryClient.invalidateQueries( { queryKey: connectedWpcomSitesQueryKey( siteId ) } );
			if ( settled.direction === 'pull' ) {
				void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			}
			const isPush = settled.direction === 'push';
			if ( settled.kind === 'success' ) {
				toast.success( isPush ? __( 'Push complete' ) : __( 'Pull complete' ) );
			} else if ( settled.kind === 'cancelled' ) {
				toast.success( isPush ? __( 'Push cancelled' ) : __( 'Pull cancelled' ) );
			} else {
				toast.error( isPush ? __( "Push didn't complete" ) : __( "Pull didn't complete" ), {
					description: settled.message,
					action: canOpenLogs ? openStudioLogsAction( connector ) : undefined,
				} );
			}
		},
		[ connector, queryClient ]
	);
}

// Pull and import failures carry the CLI's raw error. The UI shows plain
// language instead, and the raw error goes to the logs. Push keeps the CLI's
// message: it already names the cause (size limit, live import failure, timeout).
function getPlainErrorMessage( direction: SyncDirection, canOpenLogs: boolean ) {
	if ( direction === 'pull' ) {
		return canOpenLogs
			? __(
					"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details."
			  )
			: __( "Studio couldn't copy the live site. Try again." );
	}
	if ( direction === 'import' ) {
		return canOpenLogs
			? __(
					"Studio couldn't import this backup. Check that it's a complete, supported backup and try again. If the problem continues, check Studio Logs for details."
			  )
			: __(
					"Studio couldn't import this backup. Check that it's a complete, supported backup and try again."
			  );
	}
	return undefined;
}

export function openStudioLogsAction( connector: Connector ) {
	return {
		label: __( 'Open Studio Logs' ),
		onClick: () => {
			void connector.openStudioLogs().catch( ( error ) => {
				console.error( 'Failed to open Studio logs:', error );
			} );
		},
	};
}

// Mount once near the app root.
export function useSyncActivityEvents(): void {
	const connector = useConnector();
	const settleSync = useSettleSync();
	useEffect(
		() => connector.onSyncActivity( ( { siteId, activity } ) => settleSync( siteId, activity ) ),
		[ connector, settleSync ]
	);
}

// The CLI reports how a sync ends, but its events can land after the mutation
// settles, or never if it failed before it could report. So the mutation only
// settles a sync the CLI hasn't settled within this window.
const CLI_REPORT_GRACE_MS = 1500;

export function useSettleFromMutation() {
	const settleSync = useSettleSync();
	return ( siteId: string, direction: SyncDirection, error?: unknown ) => {
		let activity: SyncActivity = { kind: 'success', direction };
		if ( isSyncCancelledError( error ) ) {
			activity = { kind: 'cancelled', direction };
		} else if ( error !== undefined ) {
			const message = error instanceof Error ? error.message : String( error );
			activity = { kind: 'error', direction, message };
		}
		setTimeout( () => settleSync( siteId, activity ), CLI_REPORT_GRACE_MS );
	};
}

type LiveSyncVariables< Options > = {
	siteId: string;
	remoteSiteId: number;
	options?: Options;
	// Supplied by callers whose site isn't in the connected-sites cache yet.
	syncSite?: Pick< SyncSite, 'isPressable' >;
};

function useLiveSync< Options >(
	direction: 'push' | 'pull',
	sync: (
		connector: Connector,
		siteId: string,
		remoteSiteId: number,
		options?: Options
	) => Promise< void >
) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const settleFromMutation = useSettleFromMutation();
	// `sync_type` comes from the connected site; a cache miss reports `unknown`.
	const track = (
		{ siteId, remoteSiteId, syncSite }: LiveSyncVariables< Options >,
		startedAt: number,
		error?: unknown
	) =>
		void connector.trackEvent(
			direction === 'push' ? TRACKS_EVENTS.SYNC_PUSH : TRACKS_EVENTS.SYNC_PULL,
			buildSyncEventProps( {
				startedAt,
				site:
					syncSite ??
					queryClient
						.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( siteId ) )
						?.find( ( site ) => site.id === remoteSiteId ),
				error,
			} )
		);

	return useMutation( {
		mutationKey: direction === 'push' ? PUSH_TO_LIVE_MUTATION_KEY : PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( { siteId, remoteSiteId, options }: LiveSyncVariables< Options > ) =>
			sync( connector, siteId, remoteSiteId, options ),
		onMutate: ( { siteId, remoteSiteId } ) => {
			applySyncActivity( siteId, { kind: 'pending', direction, remoteSiteId } );
			return { startedAt: Date.now() };
		},
		onSuccess: ( _result, variables, { startedAt } ) => {
			settleFromMutation( variables.siteId, direction );
			track( variables, startedAt );
		},
		onError: ( error, variables, context ) => {
			settleFromMutation( variables.siteId, direction, error );
			if ( ! isSyncCancelledError( error ) ) {
				track( variables, context?.startedAt ?? Date.now(), error );
			}
		},
	} );
}

export const usePushSiteToLive = () =>
	useLiveSync< PushSyncOptions >( 'push', ( connector, ...args ) =>
		connector.pushSiteToLive( ...args )
	);

export const usePullSiteFromLive = () =>
	useLiveSync< PullSyncOptions >( 'pull', ( connector, ...args ) =>
		connector.pullSiteFromLive( ...args )
	);

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
