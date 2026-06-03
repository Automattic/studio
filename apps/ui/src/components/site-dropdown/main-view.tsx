import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useIsMutating } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	arrowDown,
	arrowUp,
	chevronRight,
	code,
	cog,
	external,
	Icon,
	layout,
	linkOff,
	navigation,
	page,
	plus,
	post,
	styles as stylesIcon,
	wordpress,
} from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
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
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSessionPreviewUI } from '@/hooks/use-session-ui';
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
import type { SiteDetails, WpAdminOpenTarget } from '@/data/core';
import type { ComponentProps } from 'react';

type MenuIcon = ComponentProps< typeof Icon >[ 'icon' ];
type ButtonProps = ComponentProps< typeof Button >;

const finderIcon: MenuIcon = (
	<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
		<g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
			<path
				fill="#2F88FF"
				stroke="#000"
				d="M44 38V10C44 8.89543 43.1046 8 42 8H6C4.89543 8 4 8.89543 4 10V38C4 39.1046 4.89543 40 6 40H42C43.1046 40 44 39.1046 44 38Z"
			/>
			<path stroke="#fff" d="M24.9999 8C24.9999 8 19.9999 18 20.9999 25H26.9999L27.9999 40" />
			<path stroke="#000" d="M34 40H22" />
			<path stroke="#000" d="M30 8H18" />
			<path stroke="#fff" d="M34 16V18" />
			<path stroke="#fff" d="M14 16V18" />
			<path stroke="#fff" d="M13 29C13 29 17.1905 32 24 32C30.8095 32 35 29 35 29" />
		</g>
	</svg>
);

const cursorIcon: MenuIcon = (
	<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<path
			fill="currentColor"
			d="M11.503.131L1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
		/>
	</svg>
);

const terminalIcon: MenuIcon = (
	<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<path
			fill="currentColor"
			d="M18.75 1.5H5.25A3.754 3.754 0 0 0 1.5 5.25v13.5a3.753 3.753 0 0 0 3.75 3.75h13.5a3.753 3.753 0 0 0 3.75-3.75V5.25a3.754 3.754 0 0 0-3.75-3.75M21 18.75c0 1.24-1.01 2.25-2.25 2.25H5.25C4.01 21 3 19.99 3 18.75V5.25C3 4.01 4.01 3 5.25 3h13.5C19.99 3 21 4.01 21 5.25zm-10.719-5.469l-4.5 4.5a.753.753 0 0 1-1.062 0a.75.75 0 0 1 0-1.06l3.969-3.97l-3.969-3.968a.75.75 0 0 1 1.06-1.061l4.5 4.5a.75.75 0 0 1 0 1.06zM19.5 17.25a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1 0-1.5h7.5a.75.75 0 0 1 .75.75"
		/>
	</svg>
);

const phpMyAdminIcon: MenuIcon = (
	<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<path
			fill="currentColor"
			d="M5.463 3.476C6.69 5.225 7.497 7.399 7.68 9.798a12.9 12.9 0 0 1-.672 5.254a4.3 4.3 0 0 1 2.969-1.523l.148-.008c.08-.491.47-3.45-.977-6.68c-1.068-2.386-3-3.16-3.685-3.365m1.777.037s2.406 1.066 3.326 5.547c.607 2.955.049 4.836-.402 5.773a7.35 7.35 0 0 1 4.506-1.994c.86-.065 1.695.02 2.482.233c-.1-.741-.593-3.414-2.732-5.92c-3.263-3.823-7.18-3.64-7.18-3.64Zm14.817 9.701l-17.92 3.049a2.28 2.28 0 0 1 1.535 2.254a2.3 2.3 0 0 1-.106.61c.055-.027 2.689-1.275 6.342-2.034c3.238-.673 5.723-.36 6.285-.273a6.46 6.46 0 0 1 3.864-3.606m-6.213 4.078c-2.318 0-4.641.495-6.614 1.166c-2.868.976-2.951 1.348-5.55 1.043C1.844 19.286 0 18.386 0 18.386s2.406 1.97 4.914 2.127c1.986.125 3.505-.822 5.315-1.414c2.661-.871 4.511-.97 6.253-.975C19.361 18.116 24 19.353 24 19.353s-2.11-1.044-5.033-1.72a14 14 0 0 0-3.123-.34Z"
		/>
	</svg>
);

type Props = {
	site: SiteDetails;
	// Switches the dropdown to the publish picker. Lives in the parent because
	// the picker is a sibling view at the popup level.
	onSetupClick: () => void;
	// Opens the disconnect-site confirmation dialog; owned by the parent so the
	// dialog persists after the dropdown closes.
	onDisconnectClick: () => void;
	onSettingsClick?: () => void;
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

export function MainView( { site, onSetupClick, onDisconnectClick, onSettingsClick }: Props ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const studioBrowser = useSessionPreviewUI();
	const { data: userPreferences } = useUserPreferences();
	const saveUserPreferences = useSaveUserPreferences();
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
	const localSiteUrl = getSiteUrl( site );
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label
		: __( 'Editor' );
	const editorIcon = userPreferences?.editor === 'cursor' ? cursorIcon : code;
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name
		: __( 'Terminal' );
	const filesLabel = getFilesLabel();
	const wpAdminOpenTarget = userPreferences?.wpAdminOpenTarget ?? 'default-browser';

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const openSitePath = (
		path: string,
		options?: Parameters< typeof connector.openSiteUrl >[ 2 ]
	) => {
		const openPromise = options
			? connector.openSiteUrl( site.id, path, options )
			: connector.openSiteUrl( site.id, path );
		void openPromise.catch( ( error ) => {
			console.error( 'Failed to open site URL:', error );
		} );
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
		openSitePath( '/phpmyadmin/index.php?route=/database/structure&db=wordpress' );
	};

	const openWpAdminPath = ( path: string ) => {
		if ( wpAdminOpenTarget === 'studio-browser' ) {
			studioBrowser.navigate( `/studio-auto-login?redirect_to=${ encodeURIComponent( path ) }` );
			return;
		}
		openSitePath( path );
	};

	const handleWpAdminOpenTargetChange = ( value: string ) => {
		if ( value !== 'default-browser' && value !== 'studio-browser' ) {
			return;
		}
		saveUserPreferences.mutate( { wpAdminOpenTarget: value as WpAdminOpenTarget } );
	};

	const wpAdminItems: Array< {
		label: string;
		icon: MenuIcon;
		path: string;
	} > = [
		{
			label: __( 'WP Admin' ),
			icon: external,
			path: '/wp-admin/',
		},
		{
			label: __( 'Styles' ),
			icon: stylesIcon,
			path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			path: '/wp-admin/site-editor.php?path=%2Fnavigation',
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			path: '/wp-admin/site-editor.php?path=%2Fwp_template',
		},
		{
			label: __( 'Pages' ),
			icon: page,
			path: '/wp-admin/site-editor.php?path=%2Fpage',
		},
		{
			label: __( 'Posts' ),
			icon: post,
			path: '/wp-admin/edit.php',
		},
	];

	const renderSubmenuTrigger = ( label: string, icon: MenuIcon ) => (
		<>
			<span className={ styles.submenuLabel }>
				<Icon icon={ icon } size={ 16 } className={ styles.submenuLeadingIcon } />
				<span>{ label }</span>
			</span>
			<Icon icon={ chevronRight } size={ 16 } className={ styles.submenuChevron } />
		</>
	);

	const renderMenuIcon = ( icon: MenuIcon ) => (
		<Icon icon={ icon } size={ 16 } className={ styles.menuItemIcon } />
	);

	const renderTooltipButton = ( {
		tooltip,
		children,
		...props
	}: ButtonProps & { tooltip: string } ) => (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger render={ <Button { ...props }>{ children }</Button> } />
				<Tooltip.Popup side="top">{ tooltip }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);

	const renderUrlLink = ( { text, url, label }: { text: string; url: string; label: string } ) => (
		<Tooltip.Provider delay={ 0 }>
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
				<Tooltip.Popup side="top">{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);

	return (
		<>
			<div className={ styles.rows }>
				<PopoverRow
					label={ __( 'Local' ) }
					sublabel={ renderUrlLink( {
						text: localSublabel,
						url: localSiteUrl,
						label: __( 'Open local site in your browser' ),
					} ) }
					action={
						<LocalServerToggleButton
							status={ status }
							isStopping={ isStopping }
							onClick={ handleToggleServer }
						/>
					}
				/>

				<PopoverRow
					label={ __( 'Live' ) }
					sublabel={
						liveSite
							? renderUrlLink( {
									text: stripProtocol( liveSite.url ),
									url: ensureProtocol( liveSite.url ),
									label: __( 'Open live site in your browser' ),
							  } )
							: __( 'Not yet set up' )
					}
					action={
						liveSite ? (
							<div className={ styles.rowActions }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ arrowDown }
									label={ isPullPending ? __( 'Pulling from live' ) : __( 'Pull from live' ) }
									disabled={ isSyncing }
									focusableWhenDisabled
									className={ styles.compactIconButton }
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
									className={ styles.compactIconButton }
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
									className={ styles.compactIconButton }
									onClick={ onDisconnectClick }
								/>
							</div>
						) : (
							renderTooltipButton( {
								tooltip: __( 'Connect a live site' ),
								variant: 'minimal',
								tone: 'neutral',
								size: 'small',
								disabled: isSyncing,
								onClick: onSetupClick,
								children: __( 'Connect' ),
							} )
						)
					}
				/>

				<PopoverRow
					label={ __( 'Preview' ) }
					sublabel={
						previewSnapshot
							? renderUrlLink( {
									text: __( 'Open preview' ),
									url: ensureProtocol( previewSnapshot.url ),
									label: __( 'Open preview site in your browser' ),
							  } )
							: __( 'Share a link with others' )
					}
					action={
						previewSnapshot ? (
							renderTooltipButton( {
								tooltip: __( 'Update preview site' ),
								variant: 'minimal',
								tone: 'neutral',
								size: 'small',
								loading: isPreviewPending,
								loadingAnnouncement: __( 'Updating preview' ),
								disabled: isSyncing,
								onClick: handlePreviewClick,
								children: __( 'Update' ),
							} )
						) : (
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ plus }
								label={ isPreviewPending ? __( 'Creating preview' ) : __( 'Create preview link' ) }
								disabled={ isSyncing }
								focusableWhenDisabled
								className={ styles.compactIconButton }
								onClick={ handlePreviewClick }
							/>
						)
					}
				/>
			</div>

			<Menu.Separator />
			<div className={ styles.menuItems }>
				{ onSettingsClick ? (
					<Menu.Item onClick={ onSettingsClick }>
						{ renderMenuIcon( cog ) }
						<span>{ __( 'Site settings' ) }</span>
					</Menu.Item>
				) : null }
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger disabled={ ! site.running } className={ styles.submenuTrigger }>
						{ renderSubmenuTrigger( __( 'WP Admin' ), wordpress ) }
					</Menu.SubmenuTrigger>
					<Menu.Popup side="right" align="start">
						{ wpAdminItems.map( ( item ) => (
							<Menu.Item key={ item.path } onClick={ () => openWpAdminPath( item.path ) }>
								{ renderMenuIcon( item.icon ) }
								<span>{ item.label }</span>
							</Menu.Item>
						) ) }
						<Menu.Separator />
						<Menu.RadioGroup
							value={ wpAdminOpenTarget }
							onValueChange={ handleWpAdminOpenTargetChange }
						>
							<Menu.RadioItem value="default-browser">
								{ __( 'Open in default browser' ) }
							</Menu.RadioItem>
							<Menu.RadioItem value="studio-browser">
								{ __( 'Open in Studio browser' ) }
							</Menu.RadioItem>
						</Menu.RadioGroup>
					</Menu.Popup>
				</Menu.SubmenuRoot>
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger className={ styles.submenuTrigger }>
						{ renderSubmenuTrigger( __( 'Open in…' ), external ) }
					</Menu.SubmenuTrigger>
					<Menu.Popup side="right" align="start">
						<Menu.Item onClick={ handleOpenFolder }>
							{ renderMenuIcon( finderIcon ) }
							<span>{ filesLabel }</span>
						</Menu.Item>
						<Menu.Item onClick={ handleOpenInEditor }>
							{ renderMenuIcon( editorIcon ) }
							<span>{ editorLabel }</span>
						</Menu.Item>
						<Menu.Item onClick={ handleOpenInTerminal }>
							{ renderMenuIcon( terminalIcon ) }
							<span>{ terminalLabel }</span>
						</Menu.Item>
						<Menu.Item disabled={ ! site.running } onClick={ handleOpenPhpMyAdmin }>
							{ renderMenuIcon( phpMyAdminIcon ) }
							<span>{ __( 'phpMyAdmin' ) }</span>
						</Menu.Item>
					</Menu.Popup>
				</Menu.SubmenuRoot>
			</div>
		</>
	);
}

function getFilesLabel() {
	const platform =
		typeof navigator === 'undefined' ? 'MacIntel' : navigator.platform || navigator.userAgent;
	if ( /win/i.test( platform ) ) {
		return __( 'File Explorer' );
	}
	if ( /mac/i.test( platform ) ) {
		return __( 'Finder' );
	}
	return __( 'Files' );
}

function LocalServerToggleButton( {
	status,
	isStopping,
	onClick,
}: {
	status: 'running' | 'stopped' | 'transitioning';
	isStopping: boolean;
	onClick: () => void;
} ) {
	const isTransitioning = status === 'transitioning';
	const label =
		status === 'running'
			? __( 'Stop local site' )
			: isTransitioning
			? isStopping
				? __( 'Stopping local site' )
				: __( 'Starting local site' )
			: __( 'Start local site' );

	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger
					render={
						<Button
							variant="minimal"
							tone="neutral"
							size="small"
							className={ styles.localServerButton }
							aria-label={ label }
							aria-busy={ isTransitioning || undefined }
							aria-disabled={ isTransitioning || undefined }
							data-state={ status }
							onClick={ isTransitioning ? undefined : onClick }
						>
							<svg
								className={ styles.localServerIcon }
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
								data-state={ status }
							>
								<path className={ styles.localServerPlay } d="M9 6.75 17.25 12 9 17.25Z" />
								<rect
									className={ styles.localServerStopMorph }
									x="7"
									y="7"
									width="10"
									height="10"
									rx="2"
								/>
								<circle className={ styles.localServerSpinnerTrack } cx="12" cy="12" r="7" />
								<circle className={ styles.localServerSpinner } cx="12" cy="12" r="7" />
							</svg>
						</Button>
					}
				/>
				<Tooltip.Popup side="top">{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}
