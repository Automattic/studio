import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { external, Icon, moreVertical } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { SiteIcon } from '@/components/site-icon';
import { SiteStatusButton } from '@/components/site-status-button';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { PublishSiteDialog } from './publish-site-dialog';
import { ShareDialog } from './share-dialog';
import styles from './style.module.css';
import { SyncDialog, type SyncDirection } from './sync-dialog';
import { ensureProtocol, pickLiveSite, sortConnections } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

interface SiteToolbarProps {
	site: SiteDetails;
	className?: string;
	// Opens the Pull dialog once the connection loads. Set by the deep link
	// onboarding follows after connecting a site, to nudge the first pull.
	openPullOnLoad?: boolean;
}

// Counts in-flight push / pull mutations for this site across hook instances.
// They mutate the same local runtime, so a push started elsewhere (the publish
// flow) must still read as busy here and block a concurrent pull that would
// wedge the site.
function useIsSiteBusy( siteId: string ): boolean {
	const forSite = ( mutation: { state: { variables?: unknown } } ) =>
		( mutation.state.variables as { siteId?: string } | undefined )?.siteId === siteId;
	const push = useIsMutating( { mutationKey: PUSH_TO_LIVE_MUTATION_KEY, predicate: forSite } ) > 0;
	const pull =
		useIsMutating( { mutationKey: PULL_FROM_LIVE_MUTATION_KEY, predicate: forSite } ) > 0;
	return push || pull;
}

/**
 * The site's permanent header: who you're working on and what state it's in on
 * the left, its actions on the right. Replaces the old site dropdown, whose
 * actions were hidden behind a trigger that read as a status indicator.
 *
 * Sync opens the dialog that chooses direction, destination, and what to
 * carry; Publish connects a WordPress.com site when none is. Preview sharing
 * returns with the Share button in a follow-up.
 */
export function SiteToolbar( { site, className, openPullOnLoad = false }: SiteToolbarProps ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	// The sidebar's site rows already carry a run-state dot for every site,
	// including this one. A second one in the header only earns its place once
	// the sidebar is out of view.
	const showRunState = useSidebarCollapsed();
	const login = useLogin();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const [ syncOpen, setSyncOpen ] = useState( false );
	const [ publishOpen, setPublishOpen ] = useState( false );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );
	const [ shareOpen, setShareOpen ] = useState( false );

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isBusy = useIsSiteBusy( site.id );

	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	// The dialog offers every connection; the header's connected/disconnect
	// affordances key off whichever one is the primary (production) target.
	const targets = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	// Honour the onboarding deep link once the connection is known: open the sync
	// dialog (defaulting to Pull) so a freshly connected site can bring the live
	// content down. Fires once.
	const syncOpenedRef = useRef( false );
	useEffect( () => {
		if ( openPullOnLoad && targets.length > 0 && ! syncOpenedRef.current ) {
			syncOpenedRef.current = true;
			setSyncOpen( true );
		}
	}, [ openPullOnLoad, targets ] );

	const isSignedOut = agenticReason === 'signed-out';
	const isOffline = agenticReason === 'offline';
	const syncDisabled = ! agenticEnabled || isBusy;

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const runSync = (
		direction: SyncDirection,
		target: SyncSite,
		options: PushSyncOptions | PullSyncOptions | undefined
	) => {
		if ( isBusy ) {
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

	return (
		<div className={ clsx( styles.toolbar, className ) }>
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

			<div className={ styles.actions }>
				{ /* Sharing a preview isn't a sync — it publishes a throwaway copy —
				     so it sits beside the primary action, not inside its dialog. */ }
				{ ! isSignedOut ? (
					<Tooltip.Root>
						<Tooltip.Trigger
							render={
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.action }
									disabled={ ! agenticEnabled }
									onClick={ () => setShareOpen( true ) }
								>
									{ __( 'Share' ) }
								</Button>
							}
						/>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
							{ agenticEnabled
								? __( 'Publish a preview link' )
								: __( 'Go online to share a preview.' ) }
						</Tooltip.Popup>
					</Tooltip.Root>
				) : null }
				{ isSignedOut ? (
					<Button
						variant="solid"
						tone="brand"
						size="small"
						className={ styles.action }
						loading={ login.isPending }
						loadingAnnouncement={ __( 'Opening login page' ) }
						onClick={ () => login.mutate() }
					>
						{ __( 'Log in' ) }
					</Button>
				) : liveSite ? (
					<>
						{ /* One Sync action. Direction, destination, and selection are all
						     chosen inside the dialog. */ }
						<Button
							variant="solid"
							tone="brand"
							size="small"
							className={ styles.action }
							disabled={ syncDisabled }
							focusableWhenDisabled
							onClick={ () => targets.length > 0 && setSyncOpen( true ) }
						>
							{ __( 'Sync' ) }
						</Button>
						<Menu.Root>
							<Menu.Trigger
								render={
									<IconButton
										variant="minimal"
										tone="neutral"
										size="small"
										icon={ moreVertical }
										label={ __( 'More live site actions' ) }
										disabled={ isBusy }
										focusableWhenDisabled
									/>
								}
							/>
							<Menu.Popup side="bottom" align="end">
								<Menu.Item disabled={ isBusy } onClick={ () => setDisconnectOpen( true ) }>
									{ __( 'Disconnect' ) }
								</Menu.Item>
							</Menu.Popup>
						</Menu.Root>
					</>
				) : (
					<Button
						variant="solid"
						tone="brand"
						size="small"
						className={ styles.action }
						disabled={ isOffline || isBusy }
						onClick={ () => setPublishOpen( true ) }
					>
						{ __( 'Publish' ) }
					</Button>
				) }
			</div>

			{ targets.length > 0 ? (
				<SyncDialog
					siteId={ site.id }
					connections={ targets }
					open={ syncOpen }
					onOpenChange={ setSyncOpen }
					onRun={ runSync }
					initialDirection={ openPullOnLoad ? 'pull' : 'push' }
				/>
			) : null }

			{ liveSite ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ liveSite }
					open={ disconnectOpen }
					onOpenChange={ setDisconnectOpen }
				/>
			) : null }

			{ /* Mounted only while open: it loads the account's sites on mount. */ }
			{ publishOpen ? (
				<PublishSiteDialog site={ site } open onOpenChange={ setPublishOpen } />
			) : null }

			{ shareOpen ? <ShareDialog site={ site } open onOpenChange={ setShareOpen } /> : null }
		</div>
	);
}
