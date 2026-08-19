import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import * as Menu from '@/components/menu';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from '@/components/selective-sync/lib/convert-tree-to-sync-options';
import { registerSelectiveSyncConnector } from '@/components/selective-sync/lib/get-ipc-api';
import { SyncDialog } from '@/components/selective-sync/sync-dialog';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	PUBLISH_PREVIEW_MUTATION_KEY,
	usePublishPreviewSite,
} from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots, useSnapshotUsage } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { LearnMoreDialog } from './learn-more-dialog';
import { PublishPickerView } from './publish-picker-view';
import styles from './style.module.css';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from './utils';
import '@/components/selective-sync/selective-sync.css';
import type { TreeNode } from '@/components/selective-sync/tree-view';
import type { SiteDetails } from '@/data/core';

interface SiteToolbarProps {
	site: SiteDetails;
	className?: string;
	// Opens the Pull dialog once the connection loads. Set by the deep link
	// onboarding follows after connecting a site, to nudge the first pull.
	openPullOnLoad?: boolean;
}

// Counts in-flight operations that export or mutate this site's local files.
// A mutation started from another surface must still disable this header so
// preview publishing, push, and pull cannot overlap.
function useIsSiteBusy( siteId: string ): boolean {
	const forSite = ( mutation: { state: { variables?: unknown } } ) =>
		( mutation.state.variables as { siteId?: string } | undefined )?.siteId === siteId;
	const push = useIsMutating( { mutationKey: PUSH_TO_LIVE_MUTATION_KEY, predicate: forSite } ) > 0;
	const pull =
		useIsMutating( { mutationKey: PULL_FROM_LIVE_MUTATION_KEY, predicate: forSite } ) > 0;
	const preview =
		useIsMutating( { mutationKey: PUBLISH_PREVIEW_MUTATION_KEY, predicate: forSite } ) > 0;
	return push || pull || preview;
}

/**
 * The site's permanent header: who you're working on and what state it's in on
 * the left, its actions on the right. Replaces the old site dropdown, whose
 * actions were hidden behind a trigger that read as a status indicator.
 *
 * A connected site gets a Sync menu (push/pull) and Share; an unconnected one
 * gets Publish to connect a WordPress.com site. Signed-out users see Log in.
 */
export function SiteToolbar( { site, className, openPullOnLoad = false }: SiteToolbarProps ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	// The sidebar's site rows already carry a run-state dot, so the header only
	// shows its own once the sidebar is hidden.
	const showRunState = useSidebarCollapsed();
	const login = useLogin( { source: 'site_header' } );
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const publishPreviewSite = usePublishPreviewSite();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const operation = useSiteOperation( site );

	const [ syncDialogType, setSyncDialogType ] = useState< 'push' | 'pull' | null >( null );
	const [ publishOpen, setPublishOpen ] = useState( false );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );
	const [ learnMoreOpen, setLearnMoreOpen ] = useState( false );
	const [ shareMenuOpen, setShareMenuOpen ] = useState( false );
	const [ siteMenuOpen, setSiteMenuOpen ] = useState( false );
	const [ publishedPreviewUrl, setPublishedPreviewUrl ] = useState< string | undefined >();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isBusy = useIsSiteBusy( site.id );
	const syncActivity = useSiteSyncActivity( site.id );
	const isPreviewPending =
		publishPreviewSite.isPending ||
		( syncActivity?.kind === 'pending' && syncActivity.direction === 'preview' );

	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );
	const { data: snapshots } = useSnapshots();
	const { data: snapshotUsage } = useSnapshotUsage();
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const currentPreview =
		previewSnapshot && ! isSnapshotExpired( previewSnapshot ) ? previewSnapshot : undefined;
	const previewUrl = currentPreview?.url ?? publishedPreviewUrl;
	const previewCreationBlocked =
		snapshotUsage?.siteCreationBlocked === true ||
		( snapshotUsage?.siteCount ?? 0 ) >= ( snapshotUsage?.siteLimit ?? Infinity );

	// The ported selective-sync modules resolve their data calls through the
	// active connector (see selective-sync/lib/get-ipc-api.ts).
	useEffect( () => {
		registerSelectiveSyncConnector( connector );
	}, [ connector ] );

	// Honour the onboarding deep link once the connection is known: open Pull so
	// a freshly connected site can bring the live content down. Fires once.
	const pullOpenedRef = useRef( false );
	useEffect( () => {
		if ( openPullOnLoad && liveSite && ! pullOpenedRef.current ) {
			pullOpenedRef.current = true;
			setSyncDialogType( 'pull' );
		}
	}, [ openPullOnLoad, liveSite ] );

	const isSignedOut = agenticReason === 'signed-out';
	const isOffline = agenticReason === 'offline';
	const syncDisabled = ! agenticEnabled || isBusy;

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handleDialogPush = ( tree: TreeNode[] ) => {
		if ( ! liveSite ) {
			return;
		}
		const options = convertTreeToPushOptions( tree );
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id, options },
			{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
		);
		setSyncDialogType( null );
	};

	const handleDialogPull = ( tree: TreeNode[] ) => {
		if ( ! liveSite ) {
			return;
		}
		const { optionsToSync, include_path_list: includePathList } = convertTreeToPullOptions( tree );
		pullSiteFromLive.mutate( {
			siteId: site.id,
			remoteSiteId: liveSite.id,
			options: { optionsToSync, includePathList },
		} );
		setSyncDialogType( null );
	};

	const publishPreview = () => {
		if ( syncDisabled ) {
			return;
		}
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				// Pass the existing hostname so the CLI updates that preview instead of
				// creating a new one (see getSnapshotHostname).
				existingHostname: currentPreview
					? getSnapshotHostname( currentPreview )
					: previewUrl
					? stripProtocol( previewUrl )
					: undefined,
			},
			{
				onSuccess: ( { url } ) => {
					setPublishedPreviewUrl( url );
					setShareMenuOpen( true );
				},
			}
		);
	};

	const localSiteUrl = getSiteUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;
	const { status, statusLabel, localSublabel } = deriveSiteStatus(
		site,
		isStarting,
		isStopping,
		operation
	);
	const toggleSiteRunning = () =>
		site.running ? stopSite.mutate( site.id ) : startSite.mutate( site.id );

	return (
		<div className={ clsx( styles.toolbar, className ) }>
			<Menu.Root open={ siteMenuOpen } onOpenChange={ setSiteMenuOpen }>
				<Menu.Trigger
					render={
						<button type="button" className={ styles.identity }>
							<span className={ styles.siteIconWrap }>
								<SiteIcon
									className={ clsx( styles.siteIcon, showRunState && styles.siteIconCutout ) }
									seed={ `${ site.id }:${ site.name }:${ site.path }` }
									imageSrc={ site.siteIcon }
								/>
								{ showRunState ? (
									<span
										className={ clsx(
											styles.statusBadge,
											status === 'transitioning' && styles.statusBadgeBlink
										) }
										role="img"
										aria-label={ statusLabel }
									>
										<span
											className={ clsx( styles.statusDot, styles[ `statusDot_${ status }` ] ) }
											aria-hidden="true"
										/>
									</span>
								) : null }
							</span>
							<span className={ styles.identityText }>
								<span className={ styles.siteName }>{ site.name }</span>
								<span className={ styles.siteUrlStatic }>{ localSublabel }</span>
							</span>
						</button>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.siteMenu }>
					<Menu.Item disabled={ isStarting || isStopping } onClick={ toggleSiteRunning }>
						{ site.running ? __( 'Stop site' ) : __( 'Start site' ) }
					</Menu.Item>
					<Menu.Item disabled={ ! canOpenLocalSite } onClick={ () => openExternal( localSiteUrl ) }>
						{ __( 'Open in browser' ) }
					</Menu.Item>
					<Menu.Separator />
					<div className={ styles.siteMenuDetail }>
						<span className={ styles.siteMenuDetailLabel }>{ __( 'Local address' ) }</span>
						<span className={ styles.siteMenuDetailValue }>{ getSiteDisplayUrl( site ) }</span>
					</div>
				</Menu.Popup>
			</Menu.Root>

			<div className={ styles.actions }>
				{ ! isSignedOut ? (
					<Menu.Root open={ shareMenuOpen } onOpenChange={ setShareMenuOpen }>
						<Menu.Trigger
							render={
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									loading={ isPreviewPending }
									loadingAnnouncement={
										previewUrl ? __( 'Updating preview' ) : __( 'Creating preview' )
									}
								>
									{ __( 'Share' ) }
								</Button>
							}
						/>
						<Menu.Popup side="bottom" align="end" className={ styles.shareMenu }>
							{ previewUrl ? (
								<>
									<Menu.Group>
										<Menu.GroupLabel>
											<div className={ styles.previewUrlRow }>
												<span className={ styles.previewUrl }>{ stripProtocol( previewUrl ) }</span>
												<CopyButton
													className={ styles.shareCopy }
													text={ ensureProtocol( previewUrl ) }
													label={ __( 'Copy preview link' ) }
													variant="plain"
												/>
											</div>
										</Menu.GroupLabel>
									</Menu.Group>
									<Menu.Separator />
									<div className={ styles.shareActions }>
										<Menu.Item
											className={ styles.shareAction }
											onClick={ () => openExternal( ensureProtocol( previewUrl ) ) }
										>
											{ __( 'Open in browser' ) }
										</Menu.Item>
										<Menu.Item
											className={ styles.shareAction }
											disabled={ syncDisabled }
											onClick={ publishPreview }
										>
											{ __( 'Push' ) }
										</Menu.Item>
									</div>
								</>
							) : (
								<>
									<p className={ styles.previewDescription }>
										{ __( 'Create a temporary share link that expires in 7 days.' ) }
									</p>
									<Menu.Item
										disabled={ syncDisabled || previewCreationBlocked }
										onClick={ publishPreview }
									>
										{ __( 'Create preview' ) }
									</Menu.Item>
								</>
							) }
						</Menu.Popup>
					</Menu.Root>
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
						<Menu.Root>
							<Menu.Trigger
								render={
									<Button
										variant="solid"
										tone="brand"
										size="small"
										className={ styles.primaryAction }
										disabled={ syncDisabled }
										focusableWhenDisabled
									>
										{ __( 'Sync' ) }
									</Button>
								}
							/>
							<Menu.Popup side="bottom" align="end" className={ styles.syncMenu }>
								<p className={ styles.menuIntro }>
									{ __(
										'Move files and database content between this local site and its connected live site.'
									) }
								</p>
								<div className={ styles.shareActions }>
									<Menu.Item
										className={ styles.shareAction }
										onClick={ () => setSyncDialogType( 'push' ) }
									>
										{ __( 'Push…' ) }
									</Menu.Item>
									<Menu.Item
										className={ styles.shareAction }
										onClick={ () => setSyncDialogType( 'pull' ) }
									>
										{ __( 'Pull…' ) }
									</Menu.Item>
								</div>
								<Menu.Separator />
								<Menu.Item onClick={ () => setLearnMoreOpen( true ) }>
									{ __( 'Learn more' ) }
								</Menu.Item>
							</Menu.Popup>
						</Menu.Root>
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
					<Menu.Root open={ publishOpen } onOpenChange={ setPublishOpen }>
						<Menu.Trigger
							render={
								<Button
									variant="solid"
									tone="brand"
									size="small"
									className={ clsx( styles.action, styles.primaryAction ) }
									disabled={ isOffline || isBusy }
								>
									{ __( 'Publish' ) }
								</Button>
							}
						/>
						{ publishOpen ? (
							<Menu.Popup side="bottom" align="end" className={ styles.publishMenu }>
								<PublishPickerView
									site={ site }
									onLearnMore={ () => setLearnMoreOpen( true ) }
									onClose={ () => setPublishOpen( false ) }
								/>
							</Menu.Popup>
						) : null }
					</Menu.Root>
				) }
			</div>

			{ liveSite && syncDialogType ? (
				<SyncDialog
					type={ syncDialogType }
					localSite={ site }
					remoteSite={ liveSite }
					onPush={ handleDialogPush }
					onPull={ handleDialogPull }
					onRequestClose={ () => setSyncDialogType( null ) }
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

			<LearnMoreDialog open={ learnMoreOpen } onOpenChange={ setLearnMoreOpen } />
		</div>
	);
}
