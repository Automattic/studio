import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	arrowDown,
	arrowUp,
	backup,
	code,
	cog,
	copy,
	download,
	external,
	file,
	layout,
	linkOff,
	moreHorizontal,
	navigation,
	page,
	plugins,
	plus,
	post,
	styles as stylesIcon,
	tool,
	trash,
	update,
	wordpress,
} from '@wordpress/icons';
import { Button, Dialog, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { DisconnectSiteDialog } from '@/components/site-dropdown/disconnect-site-dialog';
import {
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import {
	connectedWpcomSitesQueryKey,
	useConnectedWpcomSites,
} from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useCopySite,
	useDeleteSite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
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
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import { playIcon } from '@/lib/icons';
import { dashboardLayoutRoute } from '@/surfaces/shell/layout-dashboard';
import styles from './style.module.css';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';
import type { ComponentProps, FormEvent, ReactNode } from 'react';

type SortKey = 'name' | 'status';
type MenuIcon = ComponentProps< typeof Icon >[ 'icon' ];

const stopIcon = (
	<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
	</svg>
);

const wpAdminItems: Array< {
	label: string;
	path: string;
	icon: MenuIcon;
} > = [
	{ label: __( 'Dashboard' ), path: '/wp-admin/', icon: wordpress },
	{
		label: __( 'Styles' ),
		path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
		icon: stylesIcon,
	},
	{
		label: __( 'Navigation' ),
		path: '/wp-admin/site-editor.php?path=%2Fnavigation',
		icon: navigation,
	},
	{ label: __( 'Templates' ), path: '/wp-admin/site-editor.php?path=%2Fwp_template', icon: layout },
	{ label: __( 'Pages' ), path: '/wp-admin/site-editor.php?path=%2Fpage', icon: page },
	{ label: __( 'Posts' ), path: '/wp-admin/edit.php', icon: post },
	{ label: __( 'Plugins' ), path: '/wp-admin/plugins.php', icon: plugins },
];

export function SitesPage() {
	const { data: sites, isLoading } = useSites();
	const { data: snapshots } = useSnapshots();
	const [ search, setSearch ] = useState( '' );
	const [ sort, setSort ] = useState< SortKey >( 'name' );

	const visibleSites = useMemo( () => {
		const normalizedSearch = search.trim().toLocaleLowerCase();
		return [ ...( sites ?? [] ) ]
			.filter( ( site ) => {
				if ( ! normalizedSearch ) {
					return true;
				}
				return [ site.name, getSiteDisplayUrl( site ) ].some( ( value ) =>
					value.toLocaleLowerCase().includes( normalizedSearch )
				);
			} )
			.sort( ( a, b ) => {
				if ( sort === 'status' && a.running !== b.running ) {
					return a.running ? -1 : 1;
				}
				return a.name.localeCompare( b.name, undefined, { sensitivity: 'base' } );
			} );
	}, [ search, sites, sort ] );

	if ( isLoading ) {
		return (
			<div className={ styles.page }>
				<SitesHeader
					search={ search }
					sort={ sort }
					onSearchChange={ setSearch }
					onSortChange={ setSort }
				/>
				<p className={ styles.state }>{ __( 'Loading sites…' ) }</p>
			</div>
		);
	}

	if ( ! sites || sites.length === 0 ) {
		return (
			<div className={ styles.page }>
				<SitesHeader
					search={ search }
					sort={ sort }
					onSearchChange={ setSearch }
					onSortChange={ setSort }
				/>
				<p className={ styles.state }>{ __( 'Create your first site to get started.' ) }</p>
			</div>
		);
	}

	return (
		<div className={ styles.page }>
			<SitesHeader
				search={ search }
				sort={ sort }
				onSearchChange={ setSearch }
				onSortChange={ setSort }
			/>

			{ visibleSites.length === 0 ? (
				<p className={ styles.state }>{ __( 'No sites match your search.' ) }</p>
			) : (
				<ul className={ styles.grid }>
					{ visibleSites.map( ( site ) => (
						<li key={ site.id }>
							<SiteCard site={ site } snapshots={ snapshots } />
						</li>
					) ) }
				</ul>
			) }
		</div>
	);
}

function SitesHeader( {
	search,
	sort,
	onSearchChange,
	onSortChange,
}: {
	search: string;
	sort: SortKey;
	onSearchChange: ( search: string ) => void;
	onSortChange: ( sort: SortKey ) => void;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const handleSearchSubmit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		const formData = new FormData( event.currentTarget );
		const value = formData.get( 'site-search' );
		if ( typeof value === 'string' ) {
			onSearchChange( value );
		}
	};

	return (
		<header className={ styles.header }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ sidebarCollapsed && ! isFullscreen ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				<h1 className={ styles.headerTitle }>{ __( 'All sites' ) }</h1>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<div className={ styles.headerControls }>
					<form
						className={ styles.searchForm }
						role="search"
						aria-label={ __( 'Search sites' ) }
						onSubmit={ handleSearchSubmit }
					>
						<label className={ styles.searchLabel }>
							<span className={ styles.visuallyHidden }>{ __( 'Search sites' ) }</span>
							<input
								className={ styles.searchInput }
								type="search"
								name="site-search"
								value={ search }
								placeholder={ __( 'Search sites' ) }
								onChange={ ( event ) => onSearchChange( event.target.value ) }
							/>
						</label>
					</form>
					<label className={ styles.sortLabel }>
						<span>{ __( 'Sort' ) }</span>
						<select
							className={ styles.sortSelect }
							value={ sort }
							onChange={ ( event ) => onSortChange( event.target.value as SortKey ) }
						>
							<option value="name">{ __( 'Name' ) }</option>
							<option value="status">{ __( 'Status' ) }</option>
						</select>
					</label>
					<Link to="/onboarding" className={ styles.createAction }>
						<Icon icon={ plus } size={ 16 } aria-hidden="true" />
						<span>{ __( 'Create a site' ) }</span>
					</Link>
				</div>
			</div>
		</header>
	);
}

function SiteCard( { site, snapshots }: { site: SiteDetails; snapshots: Snapshot[] | undefined } ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const { data: userPreferences } = useUserPreferences();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();
	const pullSiteFromLive = usePullSiteFromLive();
	const pushSiteToLive = usePushSiteToLive();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const syncActivity = useSiteSyncActivity( site.id );
	const [ connectOpen, setConnectOpen ] = useState( false );
	const [ disconnectOpen, setDisconnectOpen ] = useState( false );
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const isPreviewPending = publishPreviewSite.isPending;
	const isSyncing = isPreviewPending || isPushPending || isPullPending;
	const isTransitioning = isStarting || isStopping;
	const statusLabel = isTransitioning
		? isStopping
			? __( 'Stopping…' )
			: __( 'Starting…' )
		: site.running
		? __( 'Running' )
		: __( 'Stopped' );
	const editorLabel = userPreferences?.editor
		? supportedEditorConfig[ userPreferences.editor ].label
		: __( 'Editor' );
	const terminalLabel = userPreferences?.terminal
		? terminalConfig[ userPreferences.terminal ].name
		: __( 'Terminal' );

	const openSitePath = (
		relativeUrl = '',
		options?: Parameters< typeof connector.openSiteUrl >[ 2 ]
	) => {
		void connector.openSiteUrl( site.id, relativeUrl, options ).catch( ( error ) => {
			console.error( 'Failed to open site URL:', error );
		} );
	};

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handleToggleServer = () => {
		if ( isTransitioning ) {
			return;
		}
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	const handlePreviewClick = () => {
		if ( isSyncing ) {
			return;
		}
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
			},
			{ onSuccess: ( { url } ) => openExternal( ensureProtocol( url ) ) }
		);
	};

	const handlePullClick = () => {
		if ( liveSite && ! isSyncing ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
		}
	};

	const handlePushClick = () => {
		if ( liveSite && ! isSyncing ) {
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: liveSite.id },
				{ onSuccess: () => openExternal( ensureProtocol( liveSite.url ) ) }
			);
		}
	};

	const openWpAdminPath = ( path: string ) => {
		openSitePath( path );
	};

	const handleOpenFolder = () => {
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const handleOpenInEditor = () => {
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

	const syncActivityLabel = syncActivity ? formatSyncActivity( syncActivity ) : null;
	const syncActivityIsError = syncActivity?.kind === 'error';

	return (
		<article className={ styles.card }>
			<header className={ styles.cardHeader }>
				<Link to="/sites/$siteId" params={ { siteId: site.id } } className={ styles.siteLink }>
					<span className={ styles.cardIcon } aria-hidden="true">
						<SiteIcon
							seed={ `${ site.id }:${ site.name }:${ site.path }` }
							imageSrc={ site.siteIcon }
							style={ { width: 44, height: 44, borderRadius: 8 } }
						/>
					</span>
					<span className={ styles.cardTitleBlock }>
						<span className={ styles.cardName }>{ site.name }</span>
						<span className={ styles.cardUrl }>{ getSiteDisplayUrl( site ) }</span>
					</span>
				</Link>
				<span className={ styles.cardStatus }>
					<span
						className={ clsx(
							styles.statusDot,
							site.running ? styles.statusDotRunning : styles.statusDotStopped,
							isTransitioning && styles.statusDotTransitioning
						) }
						aria-hidden="true"
					/>
					{ statusLabel }
				</span>
			</header>

			<div className={ styles.quickActions }>
				<Button
					variant={ site.running ? 'minimal' : 'solid' }
					tone={ site.running ? 'neutral' : 'brand' }
					size="small"
					className={ styles.actionButton }
					disabled={ isTransitioning }
					loading={ isTransitioning }
					loadingAnnouncement={ statusLabel }
					onClick={ handleToggleServer }
				>
					<Icon icon={ site.running ? stopIcon : playIcon } size={ 16 } aria-hidden="true" />
					<span>{ site.running ? __( 'Stop' ) : __( 'Start' ) }</span>
				</Button>
				<Button
					variant="minimal"
					tone="neutral"
					size="small"
					className={ styles.actionButton }
					disabled={ ! site.running }
					onClick={ () => openSitePath( '', { autoLogin: false } ) }
				>
					<Icon icon={ external } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Open site' ) }</span>
				</Button>
				<WpAdminMenu disabled={ ! site.running } onOpenPath={ openWpAdminPath } />
				<Link
					to="/sites/$siteId/settings"
					params={ { siteId: site.id } }
					className={ styles.settingsLink }
				>
					<Icon icon={ cog } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Settings' ) }</span>
				</Link>
			</div>

			<div className={ styles.connectionRows }>
				<ConnectionRow
					label={ __( 'Live' ) }
					value={
						liveSite ? (
							<button
								type="button"
								className={ styles.inlineLink }
								onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
							>
								{ stripProtocol( liveSite.url ) }
							</button>
						) : (
							__( 'Not connected' )
						)
					}
					actions={
						liveSite ? (
							<div className={ styles.iconActions }>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ arrowDown }
									label={ isPullPending ? __( 'Pulling from live' ) : __( 'Pull from live' ) }
									disabled={ isSyncing }
									focusableWhenDisabled
									className={ styles.iconAction }
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
									className={ styles.iconAction }
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
									className={ styles.iconAction }
									onClick={ () => setDisconnectOpen( true ) }
								/>
							</div>
						) : (
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								disabled={ isSyncing }
								onClick={ () => setConnectOpen( true ) }
							>
								{ __( 'Connect' ) }
							</Button>
						)
					}
				/>
				<ConnectionRow
					label={ __( 'Preview' ) }
					value={
						previewSnapshot ? (
							<button
								type="button"
								className={ styles.inlineLink }
								onClick={ () => openExternal( ensureProtocol( previewSnapshot.url ) ) }
							>
								{ stripProtocol( previewSnapshot.url ) }
							</button>
						) : (
							__( 'No preview link' )
						)
					}
					actions={
						<div className={ styles.previewActions }>
							{ previewSnapshot ? (
								<Button
									variant="minimal"
									tone="neutral"
									size="small"
									disabled={ isSyncing }
									onClick={ () => openExternal( ensureProtocol( previewSnapshot.url ) ) }
								>
									{ __( 'Open' ) }
								</Button>
							) : null }
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
								<Icon icon={ previewSnapshot ? update : plus } size={ 16 } aria-hidden="true" />
								<span>{ previewSnapshot ? __( 'Update' ) : __( 'Add' ) }</span>
							</Button>
						</div>
					}
				/>
			</div>

			{ syncActivityLabel ? (
				<p className={ clsx( styles.syncActivity, syncActivityIsError && styles.syncError ) }>
					{ syncActivityLabel }
				</p>
			) : null }

			<footer className={ styles.cardFooter }>
				<span className={ styles.metaText }>
					{ site.phpVersion ? sprintf( __( 'PHP %s' ), site.phpVersion ) : __( 'PHP' ) }
				</span>
				<SiteUtilitiesMenu
					site={ site }
					disabledOpenTargets={ ! site.running }
					editorLabel={ editorLabel }
					terminalLabel={ terminalLabel }
					onOpenPath={ openSitePath }
					onOpenWpAdminPath={ openWpAdminPath }
					onOpenFolder={ handleOpenFolder }
					onOpenInEditor={ handleOpenInEditor }
					onOpenInTerminal={ handleOpenInTerminal }
					onDeleteClick={ () => setDeleteOpen( true ) }
				/>
			</footer>

			<ConnectLiveSiteDialog site={ site } open={ connectOpen } onOpenChange={ setConnectOpen } />
			{ liveSite ? (
				<DisconnectSiteDialog
					localSiteId={ site.id }
					liveSite={ liveSite }
					open={ disconnectOpen }
					onOpenChange={ setDisconnectOpen }
				/>
			) : null }
			<DeleteSiteDialog site={ site } open={ deleteOpen } onOpenChange={ setDeleteOpen } />
		</article>
	);
}

function ConnectionRow( {
	label,
	value,
	actions,
}: {
	label: string;
	value: ReactNode;
	actions: ReactNode;
} ) {
	return (
		<div className={ styles.connectionRow }>
			<div className={ styles.connectionText }>
				<span className={ styles.connectionLabel }>{ label }</span>
				<span className={ styles.connectionValue }>{ value }</span>
			</div>
			<div className={ styles.connectionActions }>{ actions }</div>
		</div>
	);
}

function WpAdminMenu( {
	disabled,
	onOpenPath,
}: {
	disabled: boolean;
	onOpenPath: ( path: string ) => void;
} ) {
	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<Button
						variant="minimal"
						tone="neutral"
						size="small"
						className={ styles.actionButton }
						disabled={ disabled }
					>
						<Icon icon={ wordpress } size={ 16 } aria-hidden="true" />
						<span>{ __( 'WP Admin' ) }</span>
					</Button>
				}
			/>
			<Menu.Popup side="bottom" align="start">
				{ wpAdminItems.map( ( item ) => (
					<Menu.Item key={ item.path } onClick={ () => onOpenPath( item.path ) }>
						<Icon icon={ item.icon } size={ 16 } aria-hidden="true" />
						<span>{ item.label }</span>
					</Menu.Item>
				) ) }
			</Menu.Popup>
		</Menu.Root>
	);
}

function SiteUtilitiesMenu( {
	site,
	disabledOpenTargets,
	editorLabel,
	terminalLabel,
	onOpenPath,
	onOpenWpAdminPath,
	onOpenFolder,
	onOpenInEditor,
	onOpenInTerminal,
	onDeleteClick,
}: {
	site: SiteDetails;
	disabledOpenTargets: boolean;
	editorLabel: string;
	terminalLabel: string;
	onOpenPath: ( path?: string, options?: { autoLogin?: boolean } ) => void;
	onOpenWpAdminPath: ( path: string ) => void;
	onOpenFolder: () => void;
	onOpenInEditor: () => void;
	onOpenInTerminal: () => void;
	onDeleteClick: () => void;
} ) {
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ moreHorizontal }
						label={ __( 'More site actions' ) }
						className={ styles.moreButton }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				<Menu.Item
					disabled={ disabledOpenTargets }
					onClick={ () => onOpenPath( '', { autoLogin: false } ) }
				>
					<Icon icon={ external } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Open local site' ) }</span>
				</Menu.Item>
				<Menu.Item
					disabled={ disabledOpenTargets }
					onClick={ () => onOpenWpAdminPath( '/wp-admin/' ) }
				>
					<Icon icon={ wordpress } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Open WP Admin' ) }</span>
				</Menu.Item>
				<Menu.Item
					disabled={ disabledOpenTargets }
					onClick={ () =>
						onOpenPath( '/phpmyadmin/index.php?route=/database/structure&db=wordpress', {
							autoLogin: false,
						} )
					}
				>
					<Icon icon={ backup } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Open phpMyAdmin' ) }</span>
				</Menu.Item>
				<Menu.Separator />
				<Menu.Item onClick={ onOpenFolder }>
					<Icon icon={ file } size={ 16 } aria-hidden="true" />
					<span>{ getFilesLabel() }</span>
				</Menu.Item>
				<Menu.Item onClick={ onOpenInEditor }>
					<Icon icon={ code } size={ 16 } aria-hidden="true" />
					<span>{ editorLabel }</span>
				</Menu.Item>
				<Menu.Item onClick={ onOpenInTerminal }>
					<Icon icon={ tool } size={ 16 } aria-hidden="true" />
					<span>{ terminalLabel }</span>
				</Menu.Item>
				<Menu.Separator />
				<Menu.Item disabled={ copySite.isPending } onClick={ () => copySite.mutate( site.id ) }>
					<Icon icon={ copy } size={ 16 } aria-hidden="true" />
					<span>{ copySite.isPending ? __( 'Copying…' ) : __( 'Copy site' ) }</span>
				</Menu.Item>
				<Menu.Item disabled={ isExporting } onClick={ () => exportFullSite.mutate( site.id ) }>
					<Icon icon={ download } size={ 16 } aria-hidden="true" />
					<span>
						{ exportFullSite.isPending ? __( 'Exporting…' ) : __( 'Export entire site' ) }
					</span>
				</Menu.Item>
				<Menu.Item disabled={ isExporting } onClick={ () => exportDatabase.mutate( site.id ) }>
					<Icon icon={ backup } size={ 16 } aria-hidden="true" />
					<span>{ exportDatabase.isPending ? __( 'Exporting…' ) : __( 'Export database' ) }</span>
				</Menu.Item>
				<Menu.Separator />
				<Menu.Item onClick={ onDeleteClick }>
					<Icon icon={ trash } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Delete site' ) }</span>
				</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}

function ConnectLiveSiteDialog( {
	site,
	open,
	onOpenChange,
}: {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const pickableSites = usePickableWpcomSites( { enabled: open } );
	const [ connectingSiteId, setConnectingSiteId ] = useState< number | null >( null );
	const [ error, setError ] = useState< string | null >( null );
	const isConnecting = connectingSiteId !== null;

	const connectSite = async ( pickedSite: SyncSite ) => {
		setConnectingSiteId( pickedSite.id );
		setError( null );
		try {
			await connector.connectWpcomSite( site.id, {
				...pickedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( site.id ),
			} );
			onOpenChange( false );
		} catch ( err ) {
			setError(
				err instanceof Error ? err.message : __( 'Unable to connect this WordPress.com site.' )
			);
		} finally {
			setConnectingSiteId( null );
		}
	};

	const createNewSite = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			void connector.openExternalUrl( checkoutUrl );
		}
		onOpenChange( false );
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! isConnecting ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Connect a live site' ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					<div className={ styles.dialogBody }>
						{ pickableSites.isLoading ? (
							<p className={ styles.dialogText }>{ __( 'Loading WordPress.com sites…' ) }</p>
						) : pickableSites.data && pickableSites.data.length > 0 ? (
							<ul className={ styles.pickableList }>
								{ pickableSites.data.map( ( candidate ) => (
									<li key={ candidate.id }>
										<button
											type="button"
											className={ styles.pickableItem }
											disabled={ isConnecting }
											onClick={ () => void connectSite( candidate ) }
										>
											<span className={ styles.pickableName }>
												{ candidate.name || stripProtocol( candidate.url ) }
											</span>
											<span className={ styles.pickableUrl }>
												{ stripProtocol( candidate.url ) }
											</span>
										</button>
									</li>
								) ) }
							</ul>
						) : (
							<p className={ styles.dialogText }>
								{ __( 'No available WordPress.com sites are ready to connect.' ) }
							</p>
						) }
						{ error ? <p className={ styles.dialogError }>{ error }</p> : null }
					</div>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ isConnecting }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button variant="solid" tone="brand" disabled={ isConnecting } onClick={ createNewSite }>
						{ __( 'Create new WordPress.com site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

function DeleteSiteDialog( {
	site,
	open,
	onOpenChange,
}: {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const deleteSite = useDeleteSite();
	const [ deleteFiles, setDeleteFiles ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	const handleConfirm = () => {
		setError( null );
		deleteSite.mutate(
			{ id: site.id, deleteFiles },
			{
				onSuccess: () => onOpenChange( false ),
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to delete the site. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! deleteSite.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ sprintf( __( 'Delete %s' ), site.name ) }</Dialog.Title>
					<Dialog.CloseIcon />
				</Dialog.Header>
				<Dialog.Content>
					<div className={ styles.dialogBody }>
						<p className={ styles.dialogText }>
							{ __(
								"The site's database will be lost, including all posts, pages, comments, and media."
							) }
						</p>
						<label className={ styles.dialogCheckbox }>
							<input
								type="checkbox"
								checked={ deleteFiles }
								onChange={ ( event ) => setDeleteFiles( event.target.checked ) }
							/>
							<span>{ __( 'Delete site files from my computer' ) }</span>
						</label>
						{ error ? <p className={ styles.dialogError }>{ error }</p> : null }
					</div>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ deleteSite.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ deleteSite.isPending }
						loadingAnnouncement={ __( 'Deleting site' ) }
						onClick={ handleConfirm }
					>
						{ __( 'Delete site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

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

function formatSyncActivity(
	activity: NonNullable< ReturnType< typeof useSiteSyncActivity > >
): string {
	const action =
		activity.direction === 'push'
			? __( 'Push' )
			: activity.direction === 'pull'
			? __( 'Pull' )
			: __( 'Preview' );

	if ( activity.kind === 'pending' ) {
		return sprintf( __( '%s in progress…' ), action );
	}
	if ( activity.kind === 'success' ) {
		return sprintf( __( '%s complete.' ), action );
	}
	return activity.message || sprintf( __( '%s failed.' ), action );
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

export const sitesRoute = createRoute( {
	getParentRoute: () => dashboardLayoutRoute,
	path: '/sites',
	component: SitesPage,
} );
