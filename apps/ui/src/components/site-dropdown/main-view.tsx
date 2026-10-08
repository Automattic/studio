import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { withWpcomDetails } from '@studio/common/lib/sync/transform-sites';
import { useIsMutating } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { close, external, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo } from 'react';
import { XdebugIcon } from '@/components/xdebug-icon';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshotUsage, useSnapshots } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	useCancelSync,
} from '@/data/queries/use-sync-site';
import { useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { canCancelSyncActivity, getSyncCancelLabels } from '@/data/sync-activity';
import { getSiteUrl } from '@/lib/get-site-url';
import { LiveSitesSection } from './live-sites-section';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import { PreviewsSection } from './previews-section';
import { getSyncActivityLabel } from './trigger-secondary';
import { deriveSiteStatus, getSiteStatusName, getSiteSnapshots } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

type Props = {
	site: SiteDetails;
	activity: SyncActivity | null;
	// Switches the dropdown to the publish picker. Lives in the parent because
	// the picker is a sibling view at the popup level.
	onSetupClick: () => void;
	// Opens the disconnect-site confirmation dialog; owned by the parent so the
	// dialog persists after the dropdown closes.
	onDisconnectClick: ( liveSite: SyncSite ) => void;
	// Open the selective-sync dialog for pull/push; owned by the parent for the
	// same reason as the disconnect dialog.
	onPullClick: ( liveSite: SyncSite ) => void;
	onPushClick: ( liveSite: SyncSite ) => void;
};

// Push/pull mutations this window has in flight for the site, across hook
// instances. Only those can be cancelled: a sync the agent or a terminal runs is
// out of this window's reach.
function useSyncsStartedHere( siteId: string ): { push: boolean; pull: boolean } {
	const push =
		useIsMutating( {
			mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	const pull =
		useIsMutating( {
			mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	return { push, pull };
}

// Why there is nothing to list yet, or why a new preview can't be created.
function getPreviewsNotice(
	agenticEnabled: boolean,
	isOffline: boolean,
	hasPreviews: boolean,
	snapshotUsage?: { siteCount: number; siteLimit: number; siteCreationBlocked: boolean } | null
): string | null {
	if ( agenticEnabled ) {
		if ( snapshotUsage?.siteCreationBlocked ) {
			return __( 'Preview sites are not available for your account.' );
		}
		if ( snapshotUsage && snapshotUsage.siteCount >= snapshotUsage.siteLimit ) {
			return sprintf(
				/* translators: %d: maximum number of preview sites allowed */
				__( "You've used all %d preview sites available on your account." ),
				snapshotUsage.siteLimit
			);
		}
		return hasPreviews ? null : __( 'Share a review link for this version.' );
	}
	if ( isOffline ) {
		return __( 'Go online to share a review link.' );
	}
	return __( 'Sign in to share a review link.' );
}

function getLivePanelCopy( agenticEnabled: boolean, isOffline: boolean ): string {
	if ( agenticEnabled ) {
		return __( 'No connected site.' );
	}
	if ( isOffline ) {
		return __( 'Go online to connect a live site.' );
	}
	return __( 'Sign in to connect a live site.' );
}

export function MainView( {
	site,
	activity,
	onSetupClick,
	onDisconnectClick,
	onPullClick,
	onPushClick,
}: Props ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	const isOffline = agenticReason === 'offline';
	const login = useLogin( { source: 'site_header' } );
	const { data: snapshots } = useSnapshots();
	const { data: snapshotUsage } = useSnapshotUsage();
	const { data: storedSites } = useConnectedWpcomSites( site.id );
	const { data: wpcomSites } = useSyncableWpcomSites( { enabled: !! storedSites?.length } );
	const connectedSites = useMemo(
		() => withWpcomDetails( storedSites ?? [], wpcomSites ),
		[ storedSites, wpcomSites ]
	);

	const siteSnapshots = useMemo(
		() => getSiteSnapshots( snapshots, site.id ),
		[ snapshots, site.id ]
	);

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const cancelSync = useCancelSync();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isOperationInProgress = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const startedHere = useSyncsStartedHere( site.id );
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime. An import replaces that site's
	// files and database outright, so it locks them out too.
	const syncing = activity?.kind === 'pending' ? activity.direction : null;
	const isSyncing = syncing !== null;
	const isPreviewPending = syncing === 'preview';
	const isPushPending = syncing === 'push';
	const isPullPending = syncing === 'pull';
	const canStopSync =
		( isPushPending && startedHere.push ) || ( isPullPending && startedHere.pull );
	// …and none of them can run while the CLI holds the site either. Gate the
	// controls on both, so an operation the agent took disables them visibly rather
	// than leaving buttons that swallow the click.
	const isSiteBusy = isSyncing || isOperationInProgress;

	const isPreviewLimitReached =
		snapshotUsage?.siteCreationBlocked === true ||
		( snapshotUsage?.siteCount ?? 0 ) >= ( snapshotUsage?.siteLimit ?? Infinity );

	const { localSublabel } = deriveSiteStatus( site, isStarting, isStopping, operation );
	const localSiteUrl = getSiteUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const getSyncActionLabel = ( idle: string, pending: string, isPending: boolean ): string => {
		if ( isPending ) {
			return pending;
		}
		if ( operation ) {
			return sprintf(
				/* translators: 1: a sync action, e.g. "Pull from live". 2: an operation in progress, e.g. "Saving settings". */
				__( '%1$s (%2$s)' ),
				idle,
				getSiteOperationLabel( operation )
			);
		}
		if ( isSyncing ) {
			// translators: %s: a sync action, e.g. "Pull from live".
			return sprintf( __( '%s (sync in progress)' ), idle );
		}
		if ( ! agenticEnabled ) {
			return isOffline
				? // translators: %s: a sync action, e.g. "Pull from live".
				  sprintf( __( '%s (offline)' ), idle )
				: // translators: %s: a sync action, e.g. "Pull from live".
				  sprintf( __( '%s (sign in required)' ), idle );
		}
		return idle;
	};

	const handleStartLocalClick = () => {
		if ( isOperationInProgress || site.running ) return;
		startSite.mutate( site.id );
	};

	const handleStopLocalClick = () => {
		if ( isOperationInProgress || ! site.running ) return;
		stopSite.mutate( site.id );
	};

	const renderUrlLink = ( {
		text,
		url,
		label,
		onOpen,
	}: {
		text: string;
		url: string;
		label: string;
		onOpen?: () => void;
	} ) => (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.urlLink }
						aria-label={ label }
						onClick={ () => {
							onOpen?.();
							openExternal( url );
						} }
					>
						<span>{ text }</span>
						<Icon icon={ external } size={ 12 } aria-hidden="true" />
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);

	return (
		<div className={ styles.rows }>
			{ ( activity?.kind === 'pending' && ! isPreviewPending ) || activity?.kind === 'error' ? (
				<SyncActivityDetails
					activity={ activity }
					showCancel={ canStopSync }
					onCancel={
						activity.kind === 'pending' &&
						activity.remoteSiteId !== undefined &&
						canCancelSyncActivity( activity )
							? () =>
									cancelSync.mutate( {
										siteId: site.id,
										remoteSiteId: activity.remoteSiteId as number,
									} )
							: undefined
					}
				/>
			) : null }

			<PopoverRow
				label={
					site.enableXdebug ? (
						<>
							{ __( 'Studio' ) }
							<XdebugBadge running={ site.running } />
						</>
					) : (
						__( 'Studio' )
					)
				}
				sublabel={
					canOpenLocalSite
						? renderUrlLink( {
								text: localSublabel,
								url: localSiteUrl,
								label: __( 'Open Studio site in your browser' ),
								onOpen: () =>
									void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, {
										browser: 'external',
									} ),
						  } )
						: localSublabel
				}
				action={
					<LocalServerControl
						running={ site.running }
						starting={ isStarting }
						stopping={ isStopping }
						operation={ operation }
						onStart={ handleStartLocalClick }
						onStop={ handleStopLocalClick }
					/>
				}
			/>

			<PreviewsSection
				site={ site }
				snapshots={ siteSnapshots }
				activity={ activity }
				notice={ getPreviewsNotice(
					agenticEnabled,
					isOffline,
					siteSnapshots.length > 0,
					snapshotUsage
				) }
				canPublish={ ! isSiteBusy && agenticEnabled }
				canCreate={ ! isPreviewLimitReached }
				getPublishLabel={ ( idle ) => getSyncActionLabel( idle, __( 'Updating preview…' ), false ) }
			/>

			<LiveSitesSection
				liveSites={ connectedSites }
				activity={ activity }
				notice={ getLivePanelCopy( agenticEnabled, isOffline ) }
				actionLabel={ agenticEnabled || isOffline ? __( 'Connect site' ) : __( 'Log in' ) }
				actionDisabled={ isSiteBusy || isOffline }
				actionLoading={ ! agenticEnabled && login.isPending }
				onAction={ agenticEnabled ? onSetupClick : () => login.mutate() }
				canSync={ ! isSiteBusy && agenticEnabled }
				getSyncLabel={ getSyncActionLabel }
				onPull={ onPullClick }
				onPush={ onPushClick }
				onDisconnect={ onDisconnectClick }
			/>
		</div>
	);
}

function XdebugBadge( { running }: { running: boolean } ) {
	const label = __( 'Xdebug enabled' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<span
						className={ clsx( styles.xdebugBadge, ! running && styles.xdebugBadge_stopped ) }
						role="img"
						aria-label={ label }
					/>
				}
			>
				<XdebugIcon className={ styles.xdebugGlyph } />
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SyncActivityDetails( {
	activity,
	showCancel,
	onCancel,
}: {
	activity: Extract< SyncActivity, { kind: 'pending' | 'error' } >;
	showCancel: boolean;
	onCancel?: () => void;
} ) {
	// Same wording as the classic renderer.
	const cancel = showCancel ? getSyncCancelLabels( activity ) : null;
	const blockedLabel = cancel && ! cancel.enabled ? cancel.label : null;

	return (
		<div
			className={ clsx(
				styles.activityStatus,
				activity.kind === 'error' ? styles.activityStatusError : styles.activityStatusPending
			) }
		>
			<div className={ styles.activityStatusText } role="status" aria-live="polite">
				<div className={ styles.activityStatusTitle }>{ getSyncActivityLabel( activity ) }</div>
				<div className={ styles.activityStatusMessage }>
					{ activity.message ??
						( activity.direction === 'import'
							? __( 'Preparing the backup…' )
							: __( 'Preparing the live site…' ) ) }
				</div>
				{ blockedLabel ? (
					// Stating this inline rather than leaving it to the disabled
					// button's tooltip: nobody hovers a control that looks inert.
					<div className={ styles.activityStatusNote }>{ blockedLabel }</div>
				) : null }
			</div>
			{ cancel ? (
				// A plain Button, not an IconButton: IconButton always wraps itself in
				// a Tooltip, and tooltips never render inside this menu anyway.
				<Button
					className={ styles.cancelSyncButton }
					variant="minimal"
					tone="neutral"
					size="small"
					aria-label={ cancel.label }
					disabled={ ! cancel.enabled }
					focusableWhenDisabled
					onClick={ () => onCancel?.() }
				>
					<Icon icon={ close } size={ 20 } />
				</Button>
			) : null }
		</div>
	);
}

// The toggle tracks where the site is heading, not where it is, so an in-flight
// start reads as running before the server is actually up.
function getTargetRunning( running: boolean, starting: boolean, stopping: boolean ): boolean {
	if ( starting ) {
		return true;
	}
	if ( stopping ) {
		return false;
	}
	return running;
}

function LocalServerControl( {
	running,
	starting,
	stopping,
	operation,
	onStart,
	onStop,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	// A CLI operation (an agent settings change, another window's delete). Blocks
	// the toggle and names itself in the tooltip, so a dead control explains why.
	operation: SiteOperationKind | null;
	onStart: () => void;
	onStop: () => void;
} ) {
	// aria-disabled rather than disabled: a natively disabled button suppresses
	// the pointer events the tooltip listens for, hiding the status exactly
	// while the site is transitioning.
	const pending = starting || stopping || operation !== null;
	const targetRunning = getTargetRunning( running, starting, stopping );
	const statusLabel = sprintf(
		__( 'Site status: %s' ),
		getSiteStatusName( { running, starting, stopping, operation } )
	);
	const actionLabel = running ? __( 'Stop site' ) : __( 'Start site' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ clsx(
							styles.localServerControl,
							targetRunning && styles.localServerControl_running,
							pending && styles.localServerControl_pending
						) }
						aria-label={
							pending ? statusLabel : sprintf( __( '%1$s. %2$s' ), statusLabel, actionLabel )
						}
						role="switch"
						aria-checked={ targetRunning }
						aria-busy={ pending || undefined }
						aria-disabled={ pending || undefined }
						onClick={ () => {
							if ( pending ) {
								return;
							}
							if ( targetRunning ) {
								onStop();
							} else {
								onStart();
							}
						} }
					>
						<span className={ styles.localServerThumb } aria-hidden="true">
							<span
								className={ clsx(
									styles.localServerGlyph,
									targetRunning ? styles.pauseIcon : styles.playIcon
								) }
							/>
						</span>
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ statusLabel }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
