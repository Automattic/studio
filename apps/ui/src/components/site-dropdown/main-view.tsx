import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { arrowDown, arrowUp, external, Icon, linkOff } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { useMemo } from 'react';
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
import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps< typeof Button >;

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
	const isLocalTransitioning = isStarting || isStopping;
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewPending = publishPreviewSite.isPending;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;

	const { localSublabel } = deriveSiteStatus( site, isStarting, isStopping );
	const localSiteUrl = getSiteUrl( site );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
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

	const handleLocalServerClick = () => {
		if ( isLocalTransitioning || isSyncing ) return;
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
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

	const renderUrlLink = ( { text, url, label }: { text: string; url: string; label: string } ) => (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.urlLink }
						aria-label={ label }
						onClick={ () => openExternal( url ) }
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
			<PopoverRow
				label={ __( 'Local' ) }
				sublabel={ renderUrlLink( {
					text: localSublabel,
					url: localSiteUrl,
					label: __( 'Open local site in your browser' ),
				} ) }
				action={
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.localServerButton }
						loading={ isLocalTransitioning }
						loadingAnnouncement={
							isLocalTransitioning
								? isStopping
									? __( 'Stopping local site' )
									: __( 'Starting local site' )
								: undefined
						}
						disabled={ isLocalTransitioning || isSyncing }
						onClick={ handleLocalServerClick }
					>
						{ site.running ? __( 'Stop' ) : __( 'Start' ) }
					</Button>
				}
			/>

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
								label={ isPullPending ? __( 'Pulling from live' ) : __( 'Pull from live' ) }
								disabled={ isSyncing }
								focusableWhenDisabled
								onClick={ handlePullClick }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ arrowUp }
								label={ isPushPending ? __( 'Pushing to live' ) : __( 'Push to live' ) }
								disabled={ isSyncing }
								focusableWhenDisabled
								onClick={ handlePushClick }
							/>
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ linkOff }
								label={ __( 'Disconnect live site' ) }
								disabled={ isSyncing }
								focusableWhenDisabled
								onClick={ onDisconnectClick }
							/>
						</div>
					}
				/>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Launch on WordPress.com' ) }
					copy={ __(
						'Make it available to visitors when you’re ready to share it with the world.'
					) }
					buttonLabel={ __( 'Publish' ) }
					variant="solid"
					tone="brand"
					disabled={ isSyncing }
					onClick={ onSetupClick }
				/>
			) }

			{ previewSnapshot ? (
				<PopoverRow
					label={ __( 'Preview' ) }
					sublabel={ renderUrlLink( {
						text: __( 'Open preview' ),
						url: ensureProtocol( previewSnapshot.url ),
						label: __( 'Open preview site in your browser' ),
					} ) }
					action={ renderTooltipButton( {
						tooltip: __( 'Update preview site' ),
						variant: 'minimal',
						tone: 'neutral',
						size: 'small',
						loading: isPreviewPending,
						loadingAnnouncement: __( 'Updating preview' ),
						disabled: isSyncing,
						onClick: handlePreviewClick,
						children: __( 'Update' ),
					} ) }
				/>
			) : (
				<EnvironmentActionPanel
					title={ __( 'Share a preview' ) }
					copy={ __( 'Send a temporary link for feedback before you launch.' ) }
					buttonLabel={ __( 'Share' ) }
					variant="solid"
					tone="neutral"
					loading={ isPreviewPending }
					loadingAnnouncement={ __( 'Creating preview' ) }
					disabled={ isSyncing }
					onClick={ handlePreviewClick }
				/>
			) }
		</div>
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
				size="small"
				className={ styles.environmentActionButton }
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
