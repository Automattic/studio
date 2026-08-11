import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useIsMutating } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { arrowDown, arrowUp, copy, external, Icon, moreHorizontal } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { XdebugIcon } from '@/components/xdebug-icon';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useCheckpoints, useCreateCheckpoint } from '@/data/queries/use-checkpoints';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
} from '@/data/queries/use-sync-site';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import { getSyncActivityLabel } from './trigger-secondary';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from './utils';
import type { SiteDetails } from '@/data/core';
import type { SyncActivity, SyncLogEntry, SyncLogSummary } from '@/data/sync-activity';
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps< typeof Button >;

type Props = {
	site: SiteDetails;
	activity: SyncActivity | null;
	lastSyncLog: SyncLogSummary | null;
	// Switches the dropdown to the publish picker. Lives in the parent because
	// the picker is a sibling view at the popup level.
	onSetupClick: () => void;
	// Opens the disconnect-site confirmation dialog; owned by the parent so the
	// dialog persists after the dropdown closes.
	onDisconnectClick: () => void;
	// Open the selective-sync dialog for pull/push; owned by the parent for the
	// same reason as the disconnect dialog.
	onPullClick: () => void;
	onPushClick: () => void;
};

// Counts in-flight push/pull mutations for this site across hook instances.
// Needed because the parent kicks off a push from the publish-picker flow via
// its own mutation instance — this component's Push button would otherwise
// report "idle" while the picker-initiated push is still running.
function useIsSiteSyncing( siteId: string ): { push: boolean; pull: boolean } {
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

function getPreviewPanelCopy(
	agenticEnabled: boolean,
	isOffline: boolean,
	isPreviewExpired: boolean
): string {
	if ( agenticEnabled ) {
		return isPreviewExpired
			? __( 'The previous preview has expired.' )
			: __( 'Share a review link for this version.' );
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
		return __( 'Go online to publish your site.' );
	}
	return __( 'Sign in to publish your site.' );
}

function isLiveSyncPending(
	activity: SyncActivity | null
): activity is Extract< SyncActivity, { kind: 'pending' } > {
	return (
		activity?.kind === 'pending' &&
		( activity.direction === 'push' || activity.direction === 'pull' )
	);
}

function formatLogDuration(
	startTimestamp: string,
	endTimestamp: string | undefined,
	now: number
): string {
	const start = Date.parse( startTimestamp );
	if ( Number.isNaN( start ) ) {
		return '';
	}

	const parsedEnd = endTimestamp ? Date.parse( endTimestamp ) : now;
	const end = Number.isNaN( parsedEnd ) ? now : parsedEnd;
	const elapsedSeconds = Math.floor( Math.max( 0, end - start ) / 1000 );

	if ( elapsedSeconds < 60 ) {
		return sprintf( __( '%ds' ), elapsedSeconds );
	}

	const elapsedMinutes = Math.floor( elapsedSeconds / 60 );
	if ( elapsedMinutes < 60 ) {
		return sprintf( __( '%dm' ), elapsedMinutes );
	}

	const elapsedHours = Math.floor( elapsedMinutes / 60 );
	if ( elapsedHours < 24 ) {
		return sprintf( __( '%dh' ), elapsedHours );
	}

	return sprintf( __( '%dd' ), Math.floor( elapsedHours / 24 ) );
}

function getSyncLogEntries( activity: SyncActivity | null ): SyncLogEntry[] {
	if ( activity?.log?.length ) {
		return activity.log;
	}

	if ( activity?.kind === 'pending' ) {
		return [
			{
				timestamp: new Date().toISOString(),
				message: getSyncActivityLabel( activity ),
			},
		];
	}

	return [];
}

function getLastSyncLogMeta( summary: SyncLogSummary ): string {
	const relativeTime = formatRelativeTime( summary.completedAt );
	if ( ! relativeTime ) {
		return summary.kind === 'success' ? __( 'Completed' ) : __( 'Failed' );
	}

	const suffix =
		relativeTime === __( 'now' ) ? relativeTime : sprintf( __( '%s ago' ), relativeTime );
	return summary.kind === 'success'
		? sprintf( __( 'Completed %s' ), suffix )
		: sprintf( __( 'Failed %s' ), suffix );
}

export function MainView( {
	site,
	activity,
	lastSyncLog,
	onSetupClick,
	onDisconnectClick,
	onPullClick,
	onPushClick,
}: Props ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	const isOffline = agenticReason === 'offline';
	const login = useLogin();
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );

	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const isPreviewExpired = previewSnapshot !== undefined && isSnapshotExpired( previewSnapshot );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isLocalTransitioning = isStarting || isStopping;
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewActivityPending = activity?.kind === 'pending' && activity.direction === 'preview';
	const isPreviewPending = publishPreviewSite.isPending || isPreviewActivityPending;
	const liveSyncActivity = isLiveSyncPending( activity ) ? activity : null;
	const isLiveSyncActivityPending = !! liveSyncActivity;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending || isLiveSyncActivityPending;

	const { localSublabel } = deriveSiteStatus( site, isStarting, isStopping );
	const localSiteUrl = getSiteUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;
	const supportsCheckpoints = connector.capabilities?.siteCheckpoints ?? false;
	const checkpoints = useCheckpoints( supportsCheckpoints ? site.id : undefined );
	const createCheckpoint = useCreateCheckpoint();
	const latestCheckpoint = checkpoints.data?.[ checkpoints.data.length - 1 ];

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const getSyncActionLabel = ( idle: string, pending: string, isPending: boolean ): string => {
		if ( isPending ) {
			return pending;
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

	const handlePreviewClick = () => {
		if ( isPreviewPending ) return;
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				// The CLI cannot update an expired preview site — create a new one.
				existingHostname:
					previewSnapshot && ! isPreviewExpired
						? getSnapshotHostname( previewSnapshot )
						: undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( ensureProtocol( url ) ) }
		);
	};

	const handleCopyPreviewClick = ( url: string ) => {
		void connector.copyText( url ).catch( ( error ) => {
			console.error( 'Failed to copy preview URL:', error );
		} );
	};

	const handleStartLocalClick = () => {
		if ( isLocalTransitioning || isSyncing || site.running ) return;
		startSite.mutate( site.id );
	};

	const handleStopLocalClick = () => {
		if ( isLocalTransitioning || isSyncing || ! site.running ) return;
		stopSite.mutate( site.id );
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) return;
		onPullClick();
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing ) return;
		onPushClick();
	};

	const renderTooltipButton = ( {
		tooltip,
		children,
		...props
	}: ButtonProps & { tooltip: string } ) => (
		<Tooltip.Root>
			<Tooltip.Trigger render={ <Button { ...props }>{ children }</Button> } />
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ tooltip }</Tooltip.Popup>
		</Tooltip.Root>
	);

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
			{ activity?.kind === 'pending' || activity?.kind === 'error' ? (
				<SyncActivityDetails activity={ activity } />
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
					<>
						{ canOpenLocalSite
							? renderUrlLink( {
									text: localSublabel,
									url: localSiteUrl,
									label: __( 'Open Studio site in your browser' ),
									onOpen: () =>
										void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, {
											browser: 'external',
										} ),
							  } )
							: localSublabel }
						{ supportsCheckpoints ? (
							<div>
								{ latestCheckpoint
									? sprintf(
											__( 'Checkpoint saved %s' ),
											formatRelativeTime( new Date( latestCheckpoint.createdAt ).toISOString() )
									  )
									: __( 'No checkpoints yet.' ) }
							</div>
						) : null }
					</>
				}
				action={
					<div className={ styles.rowActions }>
						{ supportsCheckpoints
							? renderTooltipButton( {
									tooltip: __( 'Save a checkpoint of the site’s files and database' ),
									variant: 'minimal',
									tone: 'neutral',
									size: 'compact',
									loading: createCheckpoint.isPending,
									onClick: () => {
										if ( ! createCheckpoint.isPending ) {
											createCheckpoint.mutate( { siteId: site.id } );
										}
									},
									children: __( 'Checkpoint' ),
							  } )
							: null }
						<LocalServerControl
							running={ site.running }
							starting={ isStarting }
							stopping={ isStopping }
							disabled={ isSyncing }
							onStart={ handleStartLocalClick }
							onStop={ handleStopLocalClick }
						/>
					</div>
				}
			/>

			{ previewSnapshot && ! isPreviewExpired ? (
				<PopoverRow
					label={ __( 'Preview' ) }
					sublabel={ __( 'Ready to share for feedback.' ) }
					action={
						<div className={ styles.rowActions }>
							{ renderTooltipButton( {
								tooltip: __( 'Open preview site in your browser' ),
								variant: 'minimal',
								tone: 'neutral',
								size: 'small',
								className: styles.rowViewButton,
								onClick: () => openExternal( ensureProtocol( previewSnapshot.url ) ),
								children: __( 'View' ),
							} ) }
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ copy }
								label={ __( 'Copy preview URL' ) }
								className={ styles.rowActionButton }
								onClick={ () => handleCopyPreviewClick( ensureProtocol( previewSnapshot.url ) ) }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ arrowUp }
								label={ getSyncActionLabel(
									__( 'Update preview site' ),
									__( 'Updating preview…' ),
									isPreviewPending
								) }
								className={ styles.rowActionButton }
								loading={ isPreviewPending }
								loadingAnnouncement={ __( 'Updating preview' ) }
								disabled={ isSyncing || ! agenticEnabled }
								focusableWhenDisabled
								onClick={ handlePreviewClick }
							/>
						</div>
					}
				/>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Preview' ) }
					copy={ getPreviewPanelCopy( agenticEnabled, isOffline, isPreviewExpired ) }
					buttonLabel={ isPreviewExpired ? __( 'Share a new one' ) : __( 'Share' ) }
					variant="outline"
					tone="neutral"
					loading={ isPreviewPending }
					loadingAnnouncement={ __( 'Creating preview' ) }
					disabled={ isSyncing || ! agenticEnabled }
					onClick={ handlePreviewClick }
				/>
			) }

			{ liveSite ? (
				<div className={ styles.liveRow }>
					<PopoverRow
						label={ __( 'Live' ) }
						sublabel={ renderUrlLink( {
							text: stripProtocol( liveSite.url ),
							url: ensureProtocol( liveSite.url ),
							label: __( 'Open live site in your browser' ),
						} ) }
						action={
							<div className={ styles.rowActions }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ arrowDown }
									label={ getSyncActionLabel(
										__( 'Pull from live' ),
										__( 'Pulling from live…' ),
										isPullPending
									) }
									className={ styles.rowActionButton }
									loading={ isPullPending }
									loadingAnnouncement={ __( 'Pulling from live' ) }
									disabled={ isSyncing || ! agenticEnabled }
									focusableWhenDisabled
									onClick={ handlePullClick }
								/>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ arrowUp }
									label={ getSyncActionLabel(
										__( 'Push to live' ),
										__( 'Pushing to live…' ),
										isPushPending
									) }
									className={ styles.rowActionButton }
									loading={ isPushPending }
									loadingAnnouncement={ __( 'Pushing to live' ) }
									disabled={ isSyncing || ! agenticEnabled }
									focusableWhenDisabled
									onClick={ handlePushClick }
								/>
								<Menu.SubmenuRoot>
									<Menu.SubmenuTrigger
										className={ styles.moreMenuTrigger }
										disabled={ isSyncing || ! agenticEnabled }
										aria-label={ __( 'More live site actions' ) }
									>
										<Icon icon={ moreHorizontal } size={ 16 } aria-hidden="true" />
									</Menu.SubmenuTrigger>
									<Menu.Popup side="right" align="start" className={ styles.moreMenuPopup }>
										<Menu.Item
											disabled={ isSyncing || ! agenticEnabled }
											onClick={ onDisconnectClick }
										>
											{ __( 'Disconnect' ) }
										</Menu.Item>
									</Menu.Popup>
								</Menu.SubmenuRoot>
							</div>
						}
					/>
					{ liveSyncActivity ? (
						<div className={ styles.liveSyncStatus }>
							<SyncProgressPanel activity={ liveSyncActivity } />
							<SyncLog entries={ getSyncLogEntries( activity ) } active />
						</div>
					) : lastSyncLog?.log.length ? (
						<div className={ styles.liveSyncStatus }>
							<LastSyncLogDisclosure summary={ lastSyncLog } />
						</div>
					) : null }
				</div>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Live' ) }
					copy={ getLivePanelCopy( agenticEnabled, isOffline ) }
					buttonLabel={ agenticEnabled || isOffline ? __( 'Publish' ) : __( 'Log in' ) }
					variant="solid"
					tone="brand"
					loading={ ! agenticEnabled && login.isPending }
					loadingAnnouncement={ __( 'Opening login page' ) }
					disabled={ isSyncing || isOffline }
					onClick={ agenticEnabled ? onSetupClick : () => login.mutate() }
				/>
			) }
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
}: {
	activity: Extract< SyncActivity, { kind: 'pending' | 'error' } >;
} ) {
	return (
		<div
			className={ clsx(
				styles.activityStatus,
				activity.kind === 'error' ? styles.activityStatusError : styles.activityStatusPending
			) }
			role="status"
			aria-live="polite"
		>
			<div className={ styles.activityStatusTitle }>{ getSyncActivityLabel( activity ) }</div>
			<div className={ styles.activityStatusMessage }>
				{ activity.message ?? __( 'Preparing the live site…' ) }
			</div>
		</div>
	);
}

function getSyncProgressDetail( activity: Extract< SyncActivity, { kind: 'pending' } > ): string {
	if ( activity.direction === 'pull' ) {
		return __( 'Bringing selected live-site changes into Studio.' );
	}

	switch ( activity.phase ) {
		case 'uploading':
			return __( 'Preparing and uploading the selected Studio changes.' );
		case 'creating-backup':
			return __( 'Creating a safety backup before the live site changes.' );
		case 'applying':
			return __( 'Updating the live site with the selected changes.' );
		case 'finishing':
			return __( 'Finishing the live-site update.' );
		default:
			return __( 'Preparing the live-site update.' );
	}
}

function SyncProgressPanel( {
	activity,
}: {
	activity: Extract< SyncActivity, { kind: 'pending' } >;
} ) {
	const progress =
		typeof activity.progress === 'number'
			? Math.max( 0, Math.min( 100, Math.round( activity.progress ) ) )
			: null;
	const progressLabel = progress !== null ? sprintf( __( '%d%%' ), progress ) : __( 'Working' );

	return (
		<div className={ styles.syncProgressPanel } role="status" aria-live="polite">
			<div className={ styles.syncProgressHeader }>
				<div className={ styles.syncProgressTitle }>{ getSyncActivityLabel( activity ) }</div>
				<div className={ styles.syncProgressPercent }>{ progressLabel }</div>
			</div>
			<div className={ styles.syncProgressDetail }>{ getSyncProgressDetail( activity ) }</div>
			<div
				className={ clsx(
					styles.syncProgressTrack,
					progress === null && styles.syncProgressTrack_indeterminate
				) }
				aria-hidden="true"
			>
				{ progress !== null ? (
					<div className={ styles.syncProgressBar } style={ { width: `${ progress }%` } } />
				) : null }
			</div>
		</div>
	);
}

function SyncLog( { entries, active }: { entries: SyncLogEntry[]; active: boolean } ) {
	const now = useSyncLogClock( active, entries );

	return (
		<div className={ styles.syncLog } aria-label={ __( 'Sync log' ) }>
			<div className={ styles.syncLogTitle }>{ __( 'Sync log' ) }</div>
			<div className={ styles.syncLogEntries }>
				<SyncLogRows entries={ entries } active={ active } now={ now } />
			</div>
		</div>
	);
}

function LastSyncLogDisclosure( { summary }: { summary: SyncLogSummary } ) {
	const now = useSyncLogClock( false, summary.log );

	return (
		<details className={ styles.lastSyncLog }>
			<summary className={ styles.lastSyncLogSummary }>
				<span>{ __( 'Last sync log' ) }</span>
				<span className={ styles.lastSyncLogMeta }>{ getLastSyncLogMeta( summary ) }</span>
			</summary>
			<div className={ styles.lastSyncLogBody }>
				<SyncLogRows entries={ summary.log } active={ false } now={ now } />
			</div>
		</details>
	);
}

function useSyncLogClock( active: boolean, entries: SyncLogEntry[] ): number {
	const [ now, setNow ] = useState( () => Date.now() );

	useEffect( () => {
		setNow( Date.now() );
		if ( ! active ) {
			return;
		}

		const interval = window.setInterval( () => setNow( Date.now() ), 1000 );
		return () => window.clearInterval( interval );
	}, [ active, entries ] );

	return now;
}

function SyncLogRows( {
	entries,
	active,
	now,
}: {
	entries: SyncLogEntry[];
	active: boolean;
	now: number;
} ) {
	return (
		<>
			{ entries.map( ( entry, index ) => {
				const nextEntry = entries[ index + 1 ];
				const endTimestamp = nextEntry?.timestamp ?? ( active ? undefined : entry.timestamp );
				return (
					<div className={ styles.syncLogEntry } key={ `${ entry.timestamp }:${ entry.message }` }>
						<time className={ styles.syncLogTime } dateTime={ entry.timestamp }>
							{ formatLogDuration( entry.timestamp, endTimestamp, now ) }
						</time>
						<div className={ styles.syncLogMessage }>{ entry.message }</div>
					</div>
				);
			} ) }
		</>
	);
}

function getLocalServerStatusName( {
	running,
	starting,
	stopping,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
} ) {
	if ( stopping ) {
		return __( 'Stopping' );
	}
	if ( starting ) {
		return __( 'Starting' );
	}
	return running ? __( 'Running' ) : __( 'Stopped' );
}

function LocalServerControl( {
	running,
	starting,
	stopping,
	disabled,
	onStart,
	onStop,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	disabled: boolean;
	onStart: () => void;
	onStop: () => void;
} ) {
	const pending = starting || stopping;
	const targetRunning = starting ? true : stopping ? false : running;
	// aria-disabled rather than disabled: a natively disabled button suppresses
	// the pointer events the tooltip listens for, hiding the status exactly
	// while the site is transitioning.
	const inert = disabled || pending;
	const statusLabel = sprintf(
		__( 'Site status: %s' ),
		getLocalServerStatusName( { running, starting, stopping } )
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
							inert ? statusLabel : sprintf( __( '%1$s. %2$s' ), statusLabel, actionLabel )
						}
						role="switch"
						aria-checked={ targetRunning }
						aria-busy={ pending || undefined }
						aria-disabled={ inert || undefined }
						onClick={ () => {
							if ( inert ) {
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

function EnvironmentActionPanel( {
	title,
	copy,
	buttonLabel,
	variant,
	tone,
	loading,
	loadingAnnouncement,
	disabled,
	onClick,
}: {
	title: string;
	copy: string;
	buttonLabel: string;
	variant: ButtonProps[ 'variant' ];
	tone: ButtonProps[ 'tone' ];
	loading?: boolean;
	loadingAnnouncement?: string;
	disabled: boolean;
	onClick: () => void;
} ) {
	return (
		<div className={ styles.environmentActionRow }>
			<div className={ styles.environmentActionText }>
				<div className={ styles.environmentActionTitle }>{ title }</div>
				<p className={ styles.environmentActionCopy }>{ copy }</p>
			</div>
			<Button
				variant={ variant }
				tone={ tone }
				size="compact"
				className={ clsx(
					styles.environmentActionButton,
					variant === 'outline' && styles.environmentActionButton_outline
				) }
				loading={ loading }
				loadingAnnouncement={ loadingAnnouncement }
				disabled={ disabled }
				onClick={ onClick }
			>
				{ buttonLabel }
			</Button>
		</div>
	);
}
