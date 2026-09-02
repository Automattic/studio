import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { external, Icon, moreHorizontal, share } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { OpenInMenu } from '@/components/open-in-menu';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
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
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { ActionButton } from './action-button';
import { deriveToolbarState } from './derive-toolbar-state';
import { PublishSiteDialog } from './publish-site-dialog';
import { ShareDialog } from './share-dialog';
import styles from './style.module.css';
import { SyncDialog } from './sync-dialog';
import { ensureProtocol, sortConnections } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

interface SiteToolbarProps {
	site: SiteDetails;
	className?: string;
	browserPath?: string;
}

type ToolbarLayout = 'full' | 'compact' | 'overflow' | 'minimal';

const TOOLBAR_LAYOUTS: ToolbarLayout[] = [ 'full', 'compact', 'overflow', 'minimal' ];
const MIN_IDENTITY_TEXT_WIDTH = 96;
const LAYOUT_EXPANSION_BUFFER = 8;

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

function CompactOpenInItems( { site, browserPath }: { site: SiteDetails; browserPath: string } ) {
	const destinations = useOpenInDestinations( site, browserPath );

	return (
		<>
			<Menu.Separator />
			<Menu.Group>
				<Menu.GroupLabel>{ __( 'Open in…' ) }</Menu.GroupLabel>
				{ destinations.map( ( destination ) => (
					<Menu.Item
						key={ destination.id }
						disabled={ destination.disabled }
						onClick={ destination.open }
					>
						<span className={ styles.compactActionsItemIcon } aria-hidden="true">
							<Icon icon={ destination.logo } size={ 18 } />
						</span>
						{ destination.label }
					</Menu.Item>
				) ) }
			</Menu.Group>
		</>
	);
}

function CompactSiteActions( {
	site,
	browserPath,
	shareEnabled,
	onShare,
}: {
	site: SiteDetails;
	browserPath?: string;
	shareEnabled: boolean;
	onShare: () => void;
} ) {
	return (
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						className={ styles.compactActionsTrigger }
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ moreHorizontal }
						label={ __( 'More site actions' ) }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end" className={ styles.compactActionsPopup }>
				<Menu.Item disabled={ ! shareEnabled } onClick={ onShare }>
					<span className={ styles.compactActionsItemIcon } aria-hidden="true">
						<Icon icon={ share } size={ 18 } />
					</span>
					{ __( 'Share…' ) }
				</Menu.Item>
				{ browserPath !== undefined ? (
					<CompactOpenInItems site={ site } browserPath={ browserPath } />
				) : null }
			</Menu.Popup>
		</Menu.Root>
	);
}

/**
 * The site's permanent header: identity and status on the left, with the
 * available site actions on the right.
 */
export function SiteToolbar( { site, className, browserPath }: SiteToolbarProps ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	// The sidebar's site rows already carry a run-state dot for every site,
	// including this one. Showing a second one in the header only earns its
	// place once the sidebar is out of view.
	const showRunState = useSidebarCollapsed();
	const login = useLogin( { source: 'site_header' } );
	const [ publishOpen, setPublishOpen ] = useState( false );
	const [ syncOpen, setSyncOpen ] = useState( false );
	const [ shareOpen, setShareOpen ] = useState( false );
	const [ toolbarLayout, setToolbarLayout ] = useState< ToolbarLayout >( 'full' );
	const toolbarRef = useRef< HTMLDivElement >( null );
	const identityRef = useRef< HTMLDivElement >( null );
	const siteNameRef = useRef< HTMLSpanElement >( null );
	const siteStatusRowRef = useRef< HTMLSpanElement >( null );
	const actionsRef = useRef< HTMLDivElement >( null );
	const requiredWidthByLayoutRef = useRef< Partial< Record< ToolbarLayout, number > > >( {} );

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const activity = useSiteSyncActivity( site.id );
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const targets = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );

	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	// Counted rather than read off a local mutation: previews are published
	// from the site's own Previews tab, which owns its hook instance.
	const isPreviewPending = useIsMutating( { mutationKey: PUBLISH_PREVIEW_MUTATION_KEY } ) > 0;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;

	const { actions } = deriveToolbarState( {
		activity,
		agenticEnabled,
		agenticReason,
		connections: targets,
		isSyncing,
		siteRunning: site.running,
	} );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const runSync = (
		direction: 'push' | 'pull',
		target: SyncSite,
		options: PushSyncOptions | PullSyncOptions | undefined
	) => {
		if ( isSyncing ) {
			return;
		}
		if ( direction === 'pull' ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: target.id, options } );
			return;
		}
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: target.id, options },
			{ onSuccess: () => openExternal( ensureProtocol( target.url ) ) }
		);
	};

	const localSiteUrl = getSiteUrl( site );
	const localSiteLabel = isStopping
		? __( 'Stopping…' )
		: isStarting
		? __( 'Starting…' )
		: getSiteDisplayUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;

	const updateToolbarLayout = useCallback( () => {
		const toolbar = toolbarRef.current;
		const identity = identityRef.current;
		const actionsElement = actionsRef.current;
		if ( ! toolbar || ! identity || ! actionsElement || toolbar.clientWidth === 0 ) {
			return;
		}

		const toolbarStyle = getComputedStyle( toolbar );
		const identityStyle = getComputedStyle( identity );
		const iconWidth = identity.firstElementChild?.getBoundingClientRect().width ?? 0;
		const identityGap = Number.parseFloat( identityStyle.columnGap || identityStyle.gap ) || 0;
		const naturalTextWidth = Math.max(
			siteNameRef.current?.scrollWidth ?? 0,
			siteStatusRowRef.current?.scrollWidth ?? 0
		);
		const minimumIdentityWidth =
			iconWidth + identityGap + Math.min( naturalTextWidth, MIN_IDENTITY_TEXT_WIDTH );
		const toolbarGap = Number.parseFloat( toolbarStyle.columnGap || toolbarStyle.gap ) || 0;
		const horizontalPadding =
			( Number.parseFloat( toolbarStyle.paddingLeft ) || 0 ) +
			( Number.parseFloat( toolbarStyle.paddingRight ) || 0 );
		const requiredWidth =
			horizontalPadding +
			toolbarGap +
			minimumIdentityWidth +
			actionsElement.getBoundingClientRect().width;
		requiredWidthByLayoutRef.current[ toolbarLayout ] = requiredWidth;

		const layoutIndex = TOOLBAR_LAYOUTS.indexOf( toolbarLayout );
		if ( toolbar.clientWidth < requiredWidth && layoutIndex < TOOLBAR_LAYOUTS.length - 1 ) {
			setToolbarLayout( TOOLBAR_LAYOUTS[ layoutIndex + 1 ] );
			return;
		}

		if ( layoutIndex > 0 ) {
			const widerLayout = TOOLBAR_LAYOUTS[ layoutIndex - 1 ];
			const widerRequiredWidth = requiredWidthByLayoutRef.current[ widerLayout ];
			if (
				widerRequiredWidth !== undefined &&
				toolbar.clientWidth >= widerRequiredWidth + LAYOUT_EXPANSION_BUFFER
			) {
				setToolbarLayout( widerLayout );
			}
		}
	}, [ toolbarLayout ] );

	useLayoutEffect( () => {
		updateToolbarLayout();
		if ( typeof ResizeObserver === 'undefined' ) {
			return;
		}
		const observer = new ResizeObserver( updateToolbarLayout );
		if ( toolbarRef.current ) observer.observe( toolbarRef.current );
		if ( identityRef.current ) observer.observe( identityRef.current );
		if ( actionsRef.current ) observer.observe( actionsRef.current );
		return () => observer.disconnect();
	}, [ actions, browserPath, localSiteLabel, site.name, showRunState, updateToolbarLayout ] );

	return (
		<div
			ref={ toolbarRef }
			className={ clsx( styles.toolbar, className ) }
			data-site-toolbar-layout={ toolbarLayout }
		>
			<div ref={ identityRef } className={ styles.identity }>
				<SiteIcon
					className={ styles.siteIcon }
					seed={ `${ site.id }:${ site.name }:${ site.path }` }
					imageSrc={ site.siteIcon }
				/>
				<div className={ styles.identityText }>
					<span ref={ siteNameRef } className={ styles.siteName }>
						{ site.name }
					</span>
					<span
						ref={ siteStatusRowRef }
						className={ clsx(
							styles.siteStatusRow,
							showRunState && styles.siteStatusRowWithButton
						) }
					>
						{ showRunState ? (
							<SiteStatusButton
								site={ site }
								isStarting={ isStarting }
								isStopping={ isStopping }
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

			<div ref={ actionsRef } className={ styles.actions }>
				{ browserPath !== undefined ? (
					<div className={ styles.openInAction }>
						<OpenInMenu key={ site.id } site={ site } browserPath={ browserPath } />
					</div>
				) : null }
				{ /* Sharing isn't a sync: it publishes a throwaway copy, so it sits
				     outside the primary action rather than inside its panel. */ }
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								variant="outline"
								tone="neutral"
								size="small"
								className={ clsx( styles.action, styles.shareAction ) }
								aria-label={ __( 'Share…' ) }
								disabled={ ! agenticEnabled }
								onClick={ () => setShareOpen( true ) }
							>
								<span className={ styles.shareActionIcon } aria-hidden="true">
									<Icon icon={ share } size={ 18 } />
								</span>
								<span className={ styles.shareActionLabel }>{ __( 'Share…' ) }</span>
							</Button>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ agenticEnabled
							? __( 'Publish a preview link' )
							: __( 'Go online to share a preview.' ) }
					</Tooltip.Popup>
				</Tooltip.Root>
				<CompactSiteActions
					site={ site }
					browserPath={ browserPath }
					shareEnabled={ agenticEnabled }
					onShare={ () => setShareOpen( true ) }
				/>

				{ actions.map( ( action ) =>
					action.id === 'publish' ? (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => setPublishOpen( true ) }
						/>
					) : action.id === 'login' ? (
						<ActionButton key={ action.id } action={ action } onClick={ () => login.mutate() } />
					) : (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => targets.length > 0 && setSyncOpen( true ) }
						/>
					)
				) }
			</div>

			{ shareOpen ? <ShareDialog site={ site } open onOpenChange={ setShareOpen } /> : null }

			{ targets.length > 0 ? (
				<SyncDialog
					siteId={ site.id }
					connections={ targets }
					open={ syncOpen }
					onOpenChange={ setSyncOpen }
					onRun={ runSync }
				/>
			) : null }

			{ /* Mounted only while open: it loads the account's sites on mount. */ }
			{ publishOpen ? (
				<PublishSiteDialog site={ site } open onOpenChange={ setPublishOpen } />
			) : null }
		</div>
	);
}
