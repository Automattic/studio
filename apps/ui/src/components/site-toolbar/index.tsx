import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { chevronDown, external, Icon } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import * as Menu from '@/components/menu';
import { SiteIcon } from '@/components/site-icon';
import { SiteStatusButton } from '@/components/site-status-button';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { PUBLISH_PREVIEW_MUTATION_KEY } from '@/data/queries/use-preview-site';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { clearSyncActivity, useSiteSyncActivity } from '@/data/sync-activity';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { ActionButton } from './action-button';
import { ConnectionsDialog } from './connections-dialog';
import { ToolbarTweaksPanel, useToolbarPreview } from './dev-tweaks';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { PreviewSitesDialog } from './preview-sites-dialog';
import { PublishPickerView } from './publish-picker-view';
import { StatusText } from './status-text';
import styles from './style.module.css';
import { useSyncMode } from './use-sync-mode';
import { ensureProtocol, getConnectionLabel, stripProtocol } from './utils';
import type { SyncModeDirection } from './use-sync-mode';
import type { SiteDetails, SyncSite } from '@/data/core';

interface SiteToolbarProps {
	site: SiteDetails;
	// Opens the status menu on mount. Used by the post-checkout `?sync=pull`
	// deep link, which lands the user here specifically to pull.
	defaultMenuOpen?: boolean;
	className?: string;
}

// Counts in-flight push/pull mutations for this site across hook instances, so
// a push kicked off from the publish-picker flow still reads as busy here.
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

// The pill counts a fresh sync in seconds, so it has to re-render to stay
// truthful. Runs only while something recent is on screen.
function useSecondsTick( active: boolean ): void {
	const [ , setTick ] = useState( 0 );
	useEffect( () => {
		if ( ! active ) {
			return;
		}
		const timer = setInterval( () => setTick( ( count ) => count + 1 ), 1000 );
		return () => clearInterval( timer );
	}, [ active ] );
}

// How long after a sync the pill keeps ticking. Past this the meta reads in
// minutes, where a per-second re-render buys nothing.
const TICKING_WINDOW_MS = 90_000;

function isRecent( isoTimestamp: string | null | undefined ): boolean {
	if ( ! isoTimestamp ) {
		return false;
	}
	const timestampMs = Date.parse( isoTimestamp );
	return Number.isFinite( timestampMs ) && Date.now() - timestampMs < TICKING_WINDOW_MS;
}

/**
 * The site's permanent header: who you're working on and what state it's in on
 * the left, one status pill and one primary action on the right. Replaces the
 * old site dropdown, whose actions were hidden behind a trigger that read as a
 * status indicator.
 */
export function SiteToolbar( { site, defaultMenuOpen = false, className }: SiteToolbarProps ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	// The sidebar's site rows already carry a run-state dot for every site,
	// including this one. Showing a second one in the header only earns its
	// place once the sidebar is out of view.
	const showRunState = useSidebarCollapsed();
	const login = useLogin();
	const [ menuOpen, setMenuOpen ] = useState( defaultMenuOpen );
	const [ pickerOpen, setPickerOpen ] = useState( false );
	const [ previewsOpen, setPreviewsOpen ] = useState( false );
	const [ connectionsOpen, setConnectionsOpen ] = useState( false );
	const [ disconnecting, setDisconnecting ] = useState< SyncSite | null >( null );

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const activity = useSiteSyncActivity( site.id );
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const {
		direction,
		setDirection,
		targets,
		target: liveSite,
		selectTarget,
	} = useSyncMode( site.id, connectedSites );

	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	// Counted rather than read off a local mutation: previews are published
	// from the dialog, which owns its own hook instance.
	const isPreviewPending = useIsMutating( { mutationKey: PUBLISH_PREVIEW_MUTATION_KEY } ) > 0;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;

	useSecondsTick(
		activity !== null ||
			isRecent( liveSite?.lastPushTimestamp ) ||
			isRecent( liveSite?.lastPullTimestamp )
	);

	// The preview hook returns the real derived state unless the dev tweaks
	// panel is driving. Temporary — see `./dev-tweaks`.
	const preview = useToolbarPreview(
		{
			activity,
			direction,
			agenticEnabled,
			agenticReason,
			liveSite,
			isSyncing,
			siteRunning: site.running,
		},
		{ running: site.running, isStarting, isStopping }
	);
	const { status, action } = preview.state;
	const previewSite =
		preview.run.running === site.running ? site : { ...site, running: preview.run.running };

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const runSync = () => {
		// While the tweaks panel drives the toolbar, the state on screen is a
		// picture — don't start real work from it.
		if ( ! liveSite || isSyncing || preview.active ) {
			return;
		}
		if ( direction === 'pull' ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
			return;
		}
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id },
			{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
		);
	};

	const handleAction = () => {
		if ( preview.active ) {
			return;
		}
		switch ( action.id ) {
			case 'login':
				login.mutate();
				return;
			case 'retry':
			case 'push':
			case 'pull':
				runSync();
		}
	};

	const localSiteUrl = getSiteUrl( site );
	const localSiteLabel = preview.run.isStopping
		? __( 'Stopping…' )
		: preview.run.isStarting
		? __( 'Starting…' )
		: getSiteDisplayUrl( site );
	const canOpenLocalSite = preview.run.running && ! preview.run.isStopping;

	return (
		<div
			className={ clsx( styles.toolbar, preview.active && styles.toolbarPreviewing, className ) }
		>
			<div className={ styles.identity }>
				<SiteIcon
					className={ styles.siteIcon }
					seed={ `${ site.id }:${ site.name }:${ site.path }` }
					imageSrc={ site.siteIcon }
				/>
				<div className={ styles.identityText }>
					<span className={ styles.siteName }>{ site.name }</span>
					<span
						className={ clsx(
							styles.siteStatusRow,
							showRunState && styles.siteStatusRowWithButton
						) }
					>
						{ showRunState ? (
							<SiteStatusButton
								site={ previewSite }
								isStarting={ preview.run.isStarting }
								isStopping={ preview.run.isStopping }
								className={ styles.siteStatusButton }
							/>
						) : null }
						{ canOpenLocalSite ? (
							<Tooltip.Root>
								<Tooltip.Trigger
									render={
										<button
											type="button"
											className={ styles.siteUrl }
											onClick={ () => openExternal( localSiteUrl ) }
										>
											<span>{ localSiteLabel }</span>
											<Icon
												className={ styles.siteUrlIcon }
												icon={ external }
												size={ 12 }
												aria-hidden="true"
											/>
										</button>
									}
								/>
								<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
									{ __( 'Open Studio site in your browser' ) }
								</Tooltip.Popup>
							</Tooltip.Root>
						) : (
							<span className={ styles.siteUrlStatic }>{ localSiteLabel }</span>
						) }
					</span>
				</div>
			</div>

			<div className={ styles.actions }>
				{ status ? <StatusText status={ status } /> : null }

				{ /* One control, two halves: the action the button is set to, and the
				     menu that sets it. Everything that used to hide behind the status
				     indicator now hangs off the thing it acts on. */ }
				<div className={ styles.split }>
					{ action.id === 'publish' ? (
						// Publish opens the site picker anchored to its own button, so
						// the flow starts where the user clicked.
						<Menu.Root modal={ false } open={ pickerOpen } onOpenChange={ setPickerOpen }>
							<Menu.Trigger
								render={ <ActionButton action={ action } className={ styles.splitMain } /> }
							/>
							<Menu.Popup side="bottom" align="end" className={ styles.pickerPopup }>
								<PublishPickerView site={ site } onClose={ () => setPickerOpen( false ) } />
							</Menu.Popup>
						</Menu.Root>
					) : (
						<ActionButton
							action={ action }
							className={ styles.splitMain }
							onClick={ handleAction }
						/>
					) }

					<Menu.Root
						modal={ false }
						open={ menuOpen }
						onOpenChange={ ( open ) => {
							setMenuOpen( open );
							// Opening the menu is the acknowledgement a persistent failure
							// was waiting for.
							if ( open && activity?.kind === 'error' ) {
								clearSyncActivity( site.id );
							}
						} }
					>
						<Menu.Trigger
							render={
								<IconButton
									variant="solid"
									tone="brand"
									size="compact"
									icon={ chevronDown }
									label={ __( 'Sync options' ) }
									className={ styles.splitToggle }
								/>
							}
						/>
						<Menu.Popup side="bottom" align="end" className={ styles.menu }>
							{ targets.length > 0 ? (
								<>
									<div className={ styles.menuGroupLabel }>{ __( 'Direction' ) }</div>
									<Menu.RadioGroup
										value={ direction }
										onValueChange={ ( value ) => setDirection( value as SyncModeDirection ) }
									>
										<Menu.RadioItem value="push" disabled={ isSyncing }>
											{ __( 'Push' ) }
											<span className={ styles.menuItemMeta }>{ __( 'Studio → live' ) }</span>
										</Menu.RadioItem>
										<Menu.RadioItem value="pull" disabled={ isSyncing }>
											{ __( 'Pull' ) }
											<span className={ styles.menuItemMeta }>{ __( 'live → Studio' ) }</span>
										</Menu.RadioItem>
									</Menu.RadioGroup>
								</>
							) : null }
							{ /* Sites connected to both a production and a staging site pick
							     which one the action — and the status beside it — refers to. */ }
							{ targets.length > 1 ? (
								<>
									<Menu.Separator />
									<div className={ styles.menuGroupLabel }>{ __( 'Site' ) }</div>
									<Menu.RadioGroup
										value={ liveSite?.id }
										onValueChange={ ( value ) => selectTarget( Number( value ) ) }
									>
										{ targets.map( ( target ) => (
											<Menu.RadioItem key={ target.id } value={ target.id } disabled={ isSyncing }>
												{ getConnectionLabel( target ) }
												<span className={ styles.menuItemMeta }>
													{ stripProtocol( target.url ) }
												</span>
											</Menu.RadioItem>
										) ) }
									</Menu.RadioGroup>
								</>
							) : null }
							{ targets.length > 0 ? <Menu.Separator /> : null }
							<Menu.Item onClick={ () => setPreviewsOpen( true ) }>
								{ __( 'Preview sites…' ) }
							</Menu.Item>
							<Menu.Item onClick={ () => setConnectionsOpen( true ) }>
								{ __( 'Connections…' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				</div>
			</div>

			<PreviewSitesDialog
				site={ site }
				busy={ isPushPending || isPullPending }
				open={ previewsOpen }
				onOpenChange={ setPreviewsOpen }
			/>
			<ConnectionsDialog
				site={ site }
				connections={ targets }
				activeId={ liveSite?.id }
				open={ connectionsOpen }
				onOpenChange={ setConnectionsOpen }
				onSelect={ selectTarget }
				onDisconnect={ ( connection ) => {
					setConnectionsOpen( false );
					setDisconnecting( connection );
				} }
			/>
			{ disconnecting ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ disconnecting }
					open
					onOpenChange={ ( next ) => {
						if ( ! next ) {
							setDisconnecting( null );
						}
					} }
				/>
			) : null }

			<ToolbarTweaksPanel />
		</div>
	);
}
