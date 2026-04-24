import { useIsMutating } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { useMemo } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
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
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from './utils';
import type { SiteDetails } from '@/data/core';

type Props = {
	site: SiteDetails;
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

export function MainView( { site, onSetupClick, onDisconnectClick }: Props ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: userPreferences } = useUserPreferences();
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );

	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewPending = publishPreviewSite.isPending;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;

	const { status, localSublabel } = deriveSiteStatus( site, isStarting, isStopping );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handleToggleServer = () => {
		if ( status === 'transitioning' ) return;
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	const handlePreviewClick = () => {
		if ( isPreviewPending ) return;
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( ensureProtocol( url ) ) }
		);
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) return;
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing ) return;
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: liveSite.id },
			{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
		);
	};

	const handleOpenFolder = () => {
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const handleOpenInEditor = () => {
		// No editor preference yet — send the user to Settings so they can
		// pick one before the action becomes useful.
		if ( ! userPreferences?.editor ) {
			void navigate( { to: '/settings' } );
			return;
		}
		void connector.openSiteInEditor( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in editor:', error );
		} );
	};

	const handleOpenInTerminal = () => {
		void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in terminal:', error );
		} );
	};

	const handleOpenPhpMyAdmin = () => {
		openExternal(
			`${ getSiteUrl( site ) }/phpmyadmin/index.php?route=/database/structure&db=wordpress`
		);
	};

	const handleOpenWpAdmin = () => {
		const siteUrl = getSiteUrl( site );
		const redirectTo = new URL( '/wp-admin/', siteUrl ).toString();
		const autoLoginUrl = new URL( '/studio-auto-login', siteUrl );
		autoLoginUrl.searchParams.set( 'redirect_to', redirectTo );
		openExternal( autoLoginUrl.toString() );
	};

	return (
		<>
			<div className={ styles.rows }>
				<PopoverRow
					label={
						<>
							{ __( 'Local site' ) }
							{ site.running ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open local site' ) }
									onClick={ () => openExternal( getSiteUrl( site ) ) }
								/>
							) : null }
						</>
					}
					sublabel={ localSublabel }
					action={
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							loading={ status === 'transitioning' }
							loadingAnnouncement={ isStopping ? __( 'Stopping' ) : __( 'Starting' ) }
							onClick={ handleToggleServer }
						>
							{ site.running ? __( 'Stop' ) : __( 'Start' ) }
						</Button>
					}
				/>

				<PopoverRow
					label={
						<>
							{ __( 'Live site' ) }
							{ liveSite ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open live site' ) }
									onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
								/>
							) : null }
						</>
					}
					sublabel={ liveSite ? stripProtocol( liveSite.url ) : __( 'Not yet set up' ) }
					action={
						liveSite ? (
							<div className={ styles.rowActions }>
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									loading={ isPullPending }
									loadingAnnouncement={ __( 'Pulling from live' ) }
									disabled={ isSyncing }
									onClick={ handlePullClick }
								>
									{ __( 'Pull' ) }
								</Button>
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									loading={ isPushPending }
									loadingAnnouncement={ __( 'Pushing to live' ) }
									disabled={ isSyncing }
									onClick={ handlePushClick }
								>
									{ __( 'Push' ) }
								</Button>
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									disabled={ isSyncing }
									onClick={ onDisconnectClick }
								>
									{ __( 'Disconnect' ) }
								</Button>
							</div>
						) : (
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								disabled={ isSyncing }
								onClick={ onSetupClick }
							>
								{ __( 'Connect' ) }
							</Button>
						)
					}
				/>

				<PopoverRow
					label={
						<>
							{ __( 'Preview site' ) }
							{ previewSnapshot ? (
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open preview site' ) }
									onClick={ () => openExternal( ensureProtocol( previewSnapshot.url ) ) }
								/>
							) : null }
						</>
					}
					sublabel={
						previewSnapshot ? stripProtocol( previewSnapshot.url ) : __( 'Not yet created' )
					}
					action={
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							loading={ isPreviewPending }
							loadingAnnouncement={
								previewSnapshot ? __( 'Updating preview' ) : __( 'Creating preview' )
							}
							disabled={ isSyncing }
							onClick={ handlePreviewClick }
						>
							{ previewSnapshot ? __( 'Update' ) : __( 'Preview' ) }
						</Button>
					}
				/>
			</div>

			<Menu.Separator />
			<div className={ styles.menuItems }>
				<Menu.Item onClick={ handleOpenFolder }>{ __( 'Open folder' ) }</Menu.Item>
				<Menu.Item onClick={ handleOpenInEditor }>{ __( 'Open in editor' ) }</Menu.Item>
				<Menu.Item onClick={ handleOpenInTerminal }>{ __( 'Open in terminal' ) }</Menu.Item>
				<Menu.Item disabled={ ! site.running } onClick={ handleOpenPhpMyAdmin }>
					{ __( 'Open phpMyAdmin' ) }
				</Menu.Item>
				<Menu.Item disabled={ ! site.running } onClick={ handleOpenWpAdmin }>
					{ __( 'Open WP admin' ) }
				</Menu.Item>
			</div>
		</>
	);
}
