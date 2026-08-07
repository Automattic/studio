import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useIsMutating } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { arrowDown, arrowUp, copy, external, Icon, moreHorizontal } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo } from 'react';
import * as Menu from '@/components/menu';
import { XdebugIcon } from '@/components/xdebug-icon';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
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
import type { SyncActivity } from '@/data/sync-activity';
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps< typeof Button >;

type Props = {
	site: SiteDetails;
	activity: SyncActivity | null;
	// Switches the dropdown to the publish picker. Lives in the parent because
	// the picker is a sibling view at the popup level.
	onSetupClick: () => void;
	// Opens the disconnect-site confirmation dialog; owned by the parent so the
	// dialog persists after the dropdown closes.
	onDisconnectClick: () => void;
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

export function MainView( { site, activity, onSetupClick, onDisconnectClick }: Props ) {
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
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isLocalTransitioning = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewPending = publishPreviewSite.isPending;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;
	// …and none of them can run while the CLI holds the site either. Gate the
	// controls on both, so a lease the agent took disables them visibly rather
	// than leaving buttons that swallow the click.
	const isSiteBusy = isSyncing || isLocalTransitioning;

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
				/* translators: 1: a sync action, e.g. "Pull from live". 2: an operation in progress, e.g. "Exporting". */
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
		if ( ! liveSite || isSyncing || isLocalTransitioning ) return;
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing || isLocalTransitioning ) return;
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id },
			{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
		);
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
						disabled={ isSyncing }
						onStart={ handleStartLocalClick }
						onStop={ handleStopLocalClick }
					/>
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
								disabled={ isSiteBusy || ! agenticEnabled }
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
					disabled={ isSiteBusy || ! agenticEnabled }
					onClick={ handlePreviewClick }
				/>
			) }

			{ liveSite ? (
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
								disabled={ isSiteBusy || ! agenticEnabled }
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
								disabled={ isSiteBusy || ! agenticEnabled }
								focusableWhenDisabled
								onClick={ handlePushClick }
							/>
							<Menu.SubmenuRoot>
								<Menu.SubmenuTrigger
									className={ styles.moreMenuTrigger }
									disabled={ isSiteBusy || ! agenticEnabled }
									aria-label={ __( 'More live site actions' ) }
								>
									<Icon icon={ moreHorizontal } size={ 16 } aria-hidden="true" />
								</Menu.SubmenuTrigger>
								<Menu.Popup side="right" align="start" className={ styles.moreMenuPopup }>
									<Menu.Item
										disabled={ isSiteBusy || ! agenticEnabled }
										onClick={ onDisconnectClick }
									>
										{ __( 'Disconnect' ) }
									</Menu.Item>
								</Menu.Popup>
							</Menu.SubmenuRoot>
						</div>
					}
				/>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Live' ) }
					copy={ getLivePanelCopy( agenticEnabled, isOffline ) }
					buttonLabel={ agenticEnabled || isOffline ? __( 'Publish' ) : __( 'Log in' ) }
					variant="solid"
					tone="brand"
					loading={ ! agenticEnabled && login.isPending }
					loadingAnnouncement={ __( 'Opening login page' ) }
					disabled={ isSiteBusy || isOffline }
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
	operation,
	disabled,
	onStart,
	onStop,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	// A CLI lease (an agent export, another window's import). Blocks the toggle
	// and names itself in the tooltip, so a dead control explains why.
	operation: SiteOperationKind | null;
	disabled: boolean;
	onStart: () => void;
	onStop: () => void;
} ) {
	const pending = starting || stopping || operation !== null;
	const targetRunning = starting ? true : stopping ? false : running;
	// aria-disabled rather than disabled: a natively disabled button suppresses
	// the pointer events the tooltip listens for, hiding the status exactly
	// while the site is transitioning.
	const inert = disabled || pending;
	const statusLabel = sprintf(
		__( 'Site status: %s' ),
		operation
			? getSiteOperationLabel( operation )
			: getLocalServerStatusName( { running, starting, stopping } )
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
