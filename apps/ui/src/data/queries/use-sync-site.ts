import { formatProgressLabel } from '@studio/common/lib/progress-label';
import { canCancelSyncActivity, isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect } from 'react';
import { getAccountJourney, completeAccountJourney } from '@/data/account-analytics';
import {
	clearToast,
	getVisibleToasts,
	openStudioLogsAction,
	toast,
	type ToastAction,
} from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { AI_SETTINGS_QUERY_KEY } from '@/data/queries/use-ai-settings';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { WP_VERSION_QUERY_KEY } from '@/data/queries/use-wordpress-versions';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { getSnapshotUrl } from '@/data/snapshot-url';
import {
	applySyncActivity,
	getSyncActivity,
	getSyncActivityRunId,
	type SyncActivity,
} from '@/data/sync-activity';
import type {
	Connector,
	PullSyncOptions,
	PushSyncOptions,
	SiteDetails,
	Snapshot,
} from '@/data/core';
import type { SyncDirection } from '@studio/common/lib/sync/activity';
import type { RemoteSite, SitesProviderId } from '@studio/providers';

// Exported so the publish panel can find a site's in-flight push or pull in
// the mutation cache.
export const PUSH_TO_LIVE_MUTATION_KEY = [ 'pushSite' ] as const;
export const PULL_FROM_LIVE_MUTATION_KEY = [ 'pullSite' ] as const;

const openSyncPanels = new Map< string, Map< symbol, boolean > >();

export function useSyncNoticeVisibility( siteId: string, open: boolean, keepLiveNotices = false ) {
	const settle = useSettleSync();
	useEffect( () => {
		if ( ! open ) return;
		const owner = Symbol();
		const panels = openSyncPanels.get( siteId ) ?? new Map< symbol, boolean >();
		panels.set( owner, keepLiveNotices );
		openSyncPanels.set( siteId, panels );
		const activity = getSyncActivity( siteId );
		if (
			activity?.kind === 'pending' &&
			( ! keepLiveNotices || activity.direction === 'preview' || activity.direction === 'import' )
		)
			clearToast( `${ activity.direction }-${ siteId }` );
		return () => {
			panels.delete( owner );
			if ( panels.size ) return;
			openSyncPanels.delete( siteId );
			const activity = getSyncActivity( siteId );
			if ( activity?.kind === 'pending' ) settle( siteId, activity );
		};
	}, [ open, siteId, settle, keepLiveNotices ] );
}

// Records progress and announces each result once, including work started outside this UI.
export function useSettleSync() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useCallback(
		( siteId: string, activity: SyncActivity ) => {
			// Only point at the logs where the user can actually open them.
			const canOpenLogs = connector.capabilities.studioLogs;
			const plainMessage =
				activity.kind === 'error' ? getPlainErrorMessage( activity, canOpenLogs ) : undefined;
			const incoming =
				activity.kind === 'error' && plainMessage
					? { ...activity, message: plainMessage }
					: activity;
			const previous = getSyncActivity( siteId );
			const didSettle = applySyncActivity( siteId, incoming );
			const settled = getSyncActivity( siteId ) ?? incoming;
			if ( didSettle && activity.kind === 'error' && plainMessage ) {
				console.error( 'Sync activity failed:', activity.direction, activity.message );
			}

			const siteName = () =>
				queryClient
					.getQueryData< SiteDetails[] >( SITES_QUERY_KEY )
					?.find( ( { id } ) => id === siteId )?.name ?? '';
			const noticeId = `${ settled.direction }-${ siteId }`;
			if ( settled.kind === 'pending' ) {
				const panels = openSyncPanels.get( siteId );
				const live = settled.direction === 'push' || settled.direction === 'pull';
				if ( panels && ( ! live || ! Array.from( panels.values() ).every( Boolean ) ) ) {
					clearToast( noticeId );
					return;
				}
				const title =
					settled.direction === 'preview'
						? settled.hostname
							? __( 'Updating preview…' )
							: __( 'Creating preview link…' )
						: settled.direction === 'import'
						? __( 'Importing backup…' )
						: settled.direction === 'push'
						? __( 'Publishing changes…' )
						: __( 'Pulling changes…' );
				let action: ToastAction | undefined;
				if ( live && settled.remoteSiteId !== undefined && canCancelSyncActivity( settled ) ) {
					const { remoteSiteId } = settled;
					const ownsTransfer = () =>
						queryClient.isMutating( {
							mutationKey:
								settled.direction === 'push'
									? PUSH_TO_LIVE_MUTATION_KEY
									: PULL_FROM_LIVE_MUTATION_KEY,
							predicate: ( mutation ) => {
								const variables = mutation.state.variables as SyncVariables< unknown > | undefined;
								return (
									variables?.siteId === siteId &&
									variables.remoteSiteId === remoteSiteId &&
									variables.provider === settled.provider
								);
							},
						} ) > 0;
					if ( ownsTransfer() ) {
						const runId = getSyncActivityRunId( siteId );
						action = ( previous?.kind === 'pending' &&
						previous.direction === settled.direction &&
						previous.provider === settled.provider &&
						previous.remoteSiteId === remoteSiteId
							? getVisibleToasts().find( ( notice ) => notice.id === noticeId && notice.processing )
									?.action
							: undefined ) ?? {
							label: __( 'Cancel' ),
							dismissOnSuccess: false,
							onClick: () => {
								const latest = getSyncActivity( siteId );
								if (
									getSyncActivityRunId( siteId ) === runId &&
									latest?.kind === 'pending' &&
									latest.direction === settled.direction &&
									latest.provider === settled.provider &&
									latest.remoteSiteId === remoteSiteId &&
									canCancelSyncActivity( latest ) &&
									ownsTransfer()
								) {
									return connector.cancelSync( siteId, remoteSiteId );
								}
							},
						};
					}
				}
				toast.processing( title, {
					id: noticeId,
					action,
					description:
						[
							siteName(),
							live &&
							settled.progress !== undefined &&
							! settled.phase &&
							! settled.message?.includes( '%' )
								? formatProgressLabel( settled.message ?? title, settled.progress )
								: live
								? settled.message
								: undefined,
						]
							.filter( Boolean )
							.join( ' · ' ) || undefined,
				} );
				return;
			}
			if ( ! didSettle ) return;
			void queryClient.invalidateQueries( { queryKey: [ 'destination-changes', siteId ] } );
			void queryClient.invalidateQueries( { queryKey: [ 'preview-status' ] } );
			if ( settled.direction === 'preview' ) {
				void queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
				if ( settled.kind === 'success' ) {
					const title = __( 'Preview link ready' );
					const description = siteName();
					const copyAction: ToastAction = {
						label: __( 'Copy link' ),
						dismissOnSuccess: false,
						onClick: async () => {
							await queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
							const latest = queryClient
								.getQueryData< Snapshot[] >( SNAPSHOTS_QUERY_KEY )
								?.filter( ( snapshot ) => snapshot.localSiteId === siteId )
								.sort( ( a, b ) => b.date - a.date )[ 0 ];
							if ( ! latest )
								throw new Error( __( 'Preview link is not available yet. Please try again.' ) );
							await connector.copyText( getSnapshotUrl( latest ) );
							const ownsNotice = ( action: ToastAction ) =>
								getVisibleToasts().some(
									( notice ) =>
										notice.id === noticeId && notice.action === action && ! notice.leaving
								);
							if ( ! ownsNotice( copyAction ) ) return;
							const copiedAction: ToastAction = {
								...copyAction,
								label: __( 'Copied' ),
								onClick: () => {},
							};
							toast.success( title, {
								id: noticeId,
								description,
								durationMs: 0,
								action: copiedAction,
							} );
							setTimeout( () => {
								if ( ownsNotice( copiedAction ) )
									toast.success( title, { id: noticeId, description, action: copyAction } );
							}, 2000 );
						},
					};
					toast.success( title, { id: noticeId, description, durationMs: 0, action: copyAction } );
				} else if ( settled.kind === 'error' ) {
					/* translators: %s: site name */
					toast.error( sprintf( __( 'Couldn’t publish preview: %s' ), siteName() ), {
						id: noticeId,
						description: settled.message,
					} );
				} else if ( settled.kind === 'cancelled' ) {
					toast.info( __( 'Preview creation cancelled' ), {
						id: noticeId,
						description: siteName(),
					} );
				}
				return;
			}
			if ( settled.direction === 'import' ) {
				// The importer replaces the site's files and database and restarts the
				// server, so everything read off that site is stale.
				for ( const queryKey of [
					SITES_QUERY_KEY,
					[ ...WP_VERSION_QUERY_KEY, siteId ],
					siteThumbnailQueryKey( siteId ),
				] ) {
					void queryClient.invalidateQueries( { queryKey } );
				}
				if ( settled.kind === 'success' ) {
					toast.success( __( 'Import finished' ), { id: noticeId, description: siteName() } );
				} else if ( settled.kind === 'error' ) {
					toast.error( __( "Import didn't complete" ), {
						id: noticeId,
						description: [ siteName(), settled.message ].filter( Boolean ).join( ' · ' ),
						action: openStudioLogsAction( connector ),
					} );
				} else if ( settled.kind === 'cancelled' ) {
					toast.info( __( 'Import cancelled' ), { id: noticeId, description: siteName() } );
				}
				return;
			}

			const provider = ( getSyncActivity( siteId )?.provider ?? 'wpcom' ) as SitesProviderId;
			void queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } );
			// A provider that rejected its config forgot it, which disconnects the account.
			if ( settled.kind === 'error' ) {
				void queryClient.invalidateQueries( { queryKey: AI_SETTINGS_QUERY_KEY } );
			}
			if ( settled.direction === 'pull' ) {
				void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			}
			const isPush = settled.direction === 'push';
			if ( settled.kind === 'success' ) {
				const remote = queryClient
					.getQueryData< RemoteSite[] >( remoteSitesQueryKey( provider, siteId ) )
					?.find( ( { id } ) => previous?.kind === 'pending' && id === previous.remoteSiteId );
				const viewSite = isPush
					? remote && ( () => connector.openExternalUrl( remote.url ) )
					: () => connector.openSiteUrl( siteId, '', { autoLogin: false } );
				( settled.warning ? toast.warning : toast.success )(
					sprintf(
						/* translators: %s: site name */
						isPush ? __( 'Published %s' ) : __( 'Changes pulled into %s' ),
						siteName()
					),
					{
						id: noticeId,
						description: settled.warning,
						action: viewSite && {
							label: __( 'View' ),
							onClick: () => viewSite(),
							dismissOnSuccess: ! settled.warning,
						},
					}
				);
			} else if ( settled.kind === 'error' ) {
				const title = isPush
					? __( 'Publishing didn’t finish' )
					: settled.localChangesApplied
					? /* translators: %s: site name */
					  sprintf( __( 'Changes pulled into %s' ), siteName() )
					: __( 'Pulling didn’t finish' );
				toast.error( title, {
					id: noticeId,
					description: [ siteName(), settled.message ].filter( Boolean ).join( ' · ' ),
					action: settled.localChangesApplied
						? {
								label: __( 'Start site' ),
								onClick: async () => {
									await connector.startSite( siteId );
									await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
								},
						  }
						: openStudioLogsAction( connector ),
				} );
			} else if ( settled.kind === 'cancelled' ) {
				toast.info( isPush ? __( 'Publishing cancelled' ) : __( 'Pull cancelled' ), {
					id: noticeId,
					description: siteName(),
				} );
			}
		},
		[ connector, queryClient ]
	);
}

// Pull and import failures carry the CLI's raw error. The UI shows plain
// language instead, and the raw error goes to the logs. Push keeps the CLI's
// message: it already names the cause (size limit, live import failure, timeout).
function getPlainErrorMessage(
	{ direction, localChangesApplied }: Extract< SyncActivity, { kind: 'error' } >,
	canOpenLogs: boolean
) {
	if ( localChangesApplied ) {
		return __( 'Couldn’t restart the site. Your changes have already been pulled.' );
	}
	if ( direction === 'pull' ) {
		return canOpenLogs
			? __(
					"Couldn't copy the live site. Try again. If the problem continues, check the logs for details."
			  )
			: __( "Couldn't copy the live site. Try again." );
	}
	if ( direction === 'import' ) {
		return canOpenLogs
			? __(
					"Couldn't import this backup. Check that it's a complete, supported backup and try again. If the problem continues, check the logs for details."
			  )
			: __(
					"Couldn't import this backup. Check that it's a complete, supported backup and try again."
			  );
	}
	return undefined;
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
		const current = getSyncActivity( siteId );
		if ( current?.kind !== 'pending' || current.direction !== direction ) return;
		const runId = getSyncActivityRunId( siteId );
		let activity: SyncActivity = { kind: 'success', direction };
		if ( isSyncCancelledError( error ) ) {
			activity = { kind: 'cancelled', direction };
		} else if ( error !== undefined ) {
			const message = error instanceof Error ? error.message : String( error );
			activity = { kind: 'error', direction, message };
		}
		setTimeout( () => {
			if ( getSyncActivityRunId( siteId ) === runId ) settleSync( siteId, activity );
		}, CLI_REPORT_GRACE_MS );
	};
}

type SyncVariables< Options > = {
	provider: SitesProviderId;
	siteId: string;
	remoteSiteId: string | number;
	options?: Options;
};

function useSync< Options >(
	direction: 'push' | 'pull',
	sync: ( connector: Connector, variables: SyncVariables< Options > ) => Promise< void >
) {
	const connector = useConnector();
	const settleFromMutation = useSettleFromMutation();
	const recordActivity = useSettleSync();
	return useMutation( {
		mutationKey: direction === 'push' ? PUSH_TO_LIVE_MUTATION_KEY : PULL_FROM_LIVE_MUTATION_KEY,
		mutationFn: ( variables: SyncVariables< Options > ) => sync( connector, variables ),
		onMutate: ( { provider, siteId, remoteSiteId } ) => {
			recordActivity( siteId, { kind: 'pending', direction, provider, remoteSiteId } );
			return {
				journey:
					direction === 'push'
						? getAccountJourney( connector, 'publish', siteId )
						: getAccountJourney( connector, 'connect_site', `${ siteId }:${ remoteSiteId }` ),
			};
		},
		onSuccess: ( _result, variables, { journey } ) => {
			completeAccountJourney( connector, journey, {
				completion_kind: direction === 'push' ? 'sync_push' : 'sync_pull',
			} );
			settleFromMutation( variables.siteId, direction );
		},
		onError: ( error, variables ) => {
			settleFromMutation( variables.siteId, direction, error );
		},
	} );
}

export const usePushSite = () =>
	useSync< PushSyncOptions >( 'push', ( connector, { provider, siteId, remoteSiteId, options } ) =>
		connector.pushSite( provider, siteId, remoteSiteId, options )
	);

export const usePullSite = () =>
	useSync< PullSyncOptions >( 'pull', ( connector, { provider, siteId, remoteSiteId, options } ) =>
		connector.pullSite( provider, siteId, remoteSiteId, options )
	);

type DisconnectVariables = {
	provider: SitesProviderId;
	siteId: string;
	remoteSiteId: string | number;
};

export function useDisconnectRemoteSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { provider, siteId, remoteSiteId }: DisconnectVariables ) =>
			connector.disconnectRemoteSite( provider, siteId, remoteSiteId ),
		onSuccess: ( _result, { provider, siteId } ) =>
			Promise.all( [
				queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } ),
				queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( provider ) } ),
			] ),
	} );
}

type CancelSyncVariables = {
	siteId: string;
	remoteSiteId: string | number;
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
