import { useIsMutating } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { cog, download, external, formatListBullets, plus, trash, upload } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
	stripProtocol,
} from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useDeleteSite,
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
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import {
	Button,
	Dialog,
	DialogCloseButton,
	DialogContent,
	DialogError,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	List,
	ListItem,
	LoadingPlaceholder,
	Menu,
} from '@/ui-desks/components';
import styles from './style.module.css';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteDetailsDropdownProps {
	site: SiteDetails;
	disabled?: boolean;
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

export function SiteDetailsDropdown( { site, disabled = false }: SiteDetailsDropdownProps ) {
	const connector = useConnector();
	const navigate = useNavigate();
	const [ open, setOpen ] = useState( false );
	const [ deleteDialogOpen, setDeleteDialogOpen ] = useState( false );
	const [ connectDialogOpen, setConnectDialogOpen ] = useState( false );
	const [ deleteFiles, setDeleteFiles ] = useState( true );
	const [ deleteError, setDeleteError ] = useState< string | null >( null );
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites, refetch: refetchConnectedSites } = useConnectedWpcomSites(
		site.id
	);
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
	const deleteSite = useDeleteSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const { status } = deriveSiteStatus( site, isStarting, isStopping );
	const checkoutUrl = connector.getPublishCheckoutUrl( site );
	const isPreviewPending = publishPreviewSite.isPending;
	const isSyncing = isPreviewPending || isPushPending || isPullPending;
	const previewActionLabel = isPreviewPending
		? __( 'Pushing to Preview' )
		: __( 'Push to Preview' );
	const pushActionLabel = isPushPending ? __( 'Pushing to Live' ) : __( 'Push to Live' );
	const pullActionLabel = isPullPending ? __( 'Pulling from Live' ) : __( 'Pull from Live' );

	const openExternal = ( url: string ) => {
		setOpen( false );
		void connector.openExternalUrl( url );
	};

	const handleSiteSettingsClick = () => {
		setOpen( false );
		void navigate( { to: '/sites/$siteId/settings', params: { siteId: site.id } } );
	};

	const handleToggleServer = () => {
		if ( status === 'transitioning' ) {
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
		publishPreviewSite.mutate( {
			siteId: site.id,
			existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
		} );
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pushSiteToLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handleDeleteClick = () => {
		setOpen( false );
		setDeleteFiles( true );
		setDeleteError( null );
		setDeleteDialogOpen( true );
	};

	const handleConnectClick = () => {
		setOpen( false );
		setConnectDialogOpen( true );
	};

	const closeConnectDialog = () => {
		setConnectDialogOpen( false );
	};

	const closeDeleteDialog = () => {
		if ( deleteSite.isPending ) {
			return;
		}
		setDeleteDialogOpen( false );
		setDeleteError( null );
	};

	const handleConfirmDelete = () => {
		setDeleteError( null );
		deleteSite.mutate(
			{ id: site.id, deleteFiles },
			{
				onSuccess: () => {
					setDeleteDialogOpen( false );
					void navigate( { to: '/' } );
				},
				onError: ( error: Error ) => {
					setDeleteError( error.message || __( 'Unable to delete the site. Please try again.' ) );
				},
			}
		);
	};

	return (
		<>
			<Menu.Root modal={ false } open={ open } onOpenChange={ setOpen }>
				<Menu.Trigger
					render={
						<Button
							className={ styles.detailsTrigger }
							disabled={ disabled }
							icon={ formatListBullets }
							label={ sprintf(
								/* translators: %s: current site name. */
								__( 'Site details for %s' ),
								site.name
							) }
							data-status={ status }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" sideOffset={ 8 } className={ styles.popup }>
					<header className={ styles.header }>
						<div className={ styles.headerIdentity }>
							<SiteBadge site={ site } size="panel" />
							<div className={ styles.headerText }>
								<div className={ styles.headerTitle } title={ site.name }>
									{ site.name }
								</div>
								<StatusLine tone={ status }>{ getHeaderStatusText( status, site ) }</StatusLine>
							</div>
						</div>
						<div className={ styles.headerActions }>
							<Button
								className={ styles.settingsButton }
								variant="filled"
								size="small"
								icon={ cog }
								label={ __( 'Open site settings' ) }
								onClick={ handleSiteSettingsClick }
							/>
							<Button
								className={ styles.serverButton }
								variant="filled"
								size="small"
								label={ site.running ? __( 'Stop site' ) : __( 'Start site' ) }
								disabled={ status === 'transitioning' }
								aria-busy={ status === 'transitioning' ? 'true' : undefined }
								onClick={ handleToggleServer }
							>
								<span
									className={ site.running ? styles.stopGlyph : styles.startGlyph }
									aria-hidden="true"
								/>
								{ getServerButtonLabel( site.running, isStarting, isStopping ) }
							</Button>
						</div>
					</header>

					<div className={ styles.divider } />

					<div className={ styles.rows }>
						<DetailsRow
							label={ __( 'Local' ) }
							status={ status }
							statusText={ getLocalStatusText( status, site ) }
							actions={
								<OpenButton
									label={ __( 'Open local site' ) }
									disabled={ ! site.running }
									onClick={ () => openExternal( getSiteUrl( site ) ) }
								/>
							}
						/>
						<DetailsRow
							label={ __( 'Preview' ) }
							status={ previewSnapshot ? 'running' : 'stopped' }
							statusText={
								previewSnapshot
									? sprintf(
											/* translators: %s: relative time since the preview site was last synced. */
											__( 'Synced %s' ),
											formatRelativeTimestamp( previewSnapshot.date )
									  )
									: __( 'Not yet created' )
							}
							actions={
								<>
									<Button
										className={ styles.syncButton }
										variant="quiet"
										size="small"
										icon={ upload }
										label={ previewActionLabel }
										disabled={ isSyncing }
										aria-busy={ isPreviewPending ? 'true' : undefined }
										onClick={ handlePreviewClick }
									>
										{ isPreviewPending ? __( 'Pushing...' ) : __( 'Push to Preview' ) }
									</Button>
									<OpenButton
										label={ __( 'Open preview site' ) }
										disabled={ ! previewSnapshot }
										onClick={ () => {
											if ( previewSnapshot ) {
												openExternal( ensureProtocol( previewSnapshot.url ) );
											}
										} }
									/>
								</>
							}
						/>
						<DetailsRow
							label={ __( 'Live' ) }
							status={ liveSite ? 'running' : 'stopped' }
							statusText={
								liveSite ? (
									<>
										<span>{ __( 'Connected' ) }</span>
										<span className={ styles.statusSeparator } aria-hidden="true" />
										<span>{ __( 'WordPress.com' ) }</span>
									</>
								) : (
									__( 'Not connected' )
								)
							}
							actions={
								liveSite ? (
									<>
										<Button
											className={ styles.syncButton }
											variant="quiet"
											size="small"
											icon={ upload }
											label={ pushActionLabel }
											disabled={ isSyncing }
											aria-busy={ isPushPending ? 'true' : undefined }
											onClick={ handlePushClick }
										>
											{ isPushPending ? __( 'Pushing...' ) : __( 'Push to Live' ) }
										</Button>
										<Button
											className={ styles.syncButton }
											variant="quiet"
											size="small"
											icon={ download }
											label={ pullActionLabel }
											disabled={ isSyncing }
											aria-busy={ isPullPending ? 'true' : undefined }
											onClick={ handlePullClick }
										>
											{ isPullPending ? __( 'Pulling...' ) : __( 'Pull' ) }
										</Button>
										<OpenButton
											label={ __( 'Open live site' ) }
											disabled={ isSyncing }
											onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
										/>
									</>
								) : (
									<Button
										className={ styles.syncButton }
										variant="filled"
										size="small"
										label={ __( 'Connect live site' ) }
										onClick={ handleConnectClick }
									>
										{ __( 'Connect' ) }
									</Button>
								)
							}
						/>
					</div>

					<div className={ styles.divider } />
					<div className={ styles.footerActions }>
						<Button
							className={ styles.deleteButton }
							variant="quiet"
							size="medium"
							icon={ trash }
							label={ __( 'Delete site' ) }
							disabled={ isSyncing || deleteSite.isPending }
							onClick={ handleDeleteClick }
						>
							{ __( 'Delete site' ) }
						</Button>
					</div>
				</Menu.Popup>
			</Menu.Root>
			<Dialog
				ariaLabel={ sprintf(
					/* translators: %s: site name. */
					__( 'Delete %s' ),
					site.name
				) }
				gap="compact"
				onClose={ closeDeleteDialog }
				open={ deleteDialogOpen }
				size="small"
			>
				<DialogHeader>
					<DialogTitle>
						{ sprintf(
							/* translators: %s: site name. */
							__( 'Delete %s' ),
							site.name
						) }
					</DialogTitle>
				</DialogHeader>
				<DialogContent className={ styles.deleteDialogContent }>
					<p className={ styles.deleteDialogText }>
						{ __(
							"The site's database will be lost, including all posts, pages, comments, and media."
						) }
					</p>
					<label className={ styles.deleteDialogCheckbox }>
						<input
							type="checkbox"
							checked={ deleteFiles }
							disabled={ deleteSite.isPending }
							onChange={ ( event ) => setDeleteFiles( event.target.checked ) }
						/>
						<span>{ __( 'Delete site files from my computer' ) }</span>
					</label>
					{ deleteError ? <DialogError>{ deleteError }</DialogError> : null }
				</DialogContent>
				<DialogFooter>
					<Button
						variant="quiet"
						size="medium"
						label={ __( 'Cancel' ) }
						disabled={ deleteSite.isPending }
						onClick={ closeDeleteDialog }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						className={ styles.confirmDeleteButton }
						variant="filled"
						size="medium"
						label={ __( 'Delete site' ) }
						disabled={ deleteSite.isPending }
						aria-busy={ deleteSite.isPending ? 'true' : undefined }
						onClick={ handleConfirmDelete }
					>
						{ deleteSite.isPending ? __( 'Deleting...' ) : __( 'Delete site' ) }
					</Button>
				</DialogFooter>
			</Dialog>
			{ connectDialogOpen ? (
				<ConnectLiveSiteDialog
					site={ site }
					canCreateNew={ Boolean( checkoutUrl ) }
					onClose={ closeConnectDialog }
					onConnected={ async () => {
						await refetchConnectedSites();
					} }
					onCreateNew={ () => {
						if ( checkoutUrl ) {
							closeConnectDialog();
							openExternal( checkoutUrl );
						}
					} }
				/>
			) : null }
		</>
	);
}

function ConnectLiveSiteDialog( {
	site,
	canCreateNew,
	onClose,
	onConnected,
	onCreateNew,
}: {
	site: SiteDetails;
	canCreateNew: boolean;
	onClose: () => void;
	onConnected: () => Promise< unknown >;
	onCreateNew: () => void;
} ) {
	const connector = useConnector();
	const { data: user, isLoading: isLoadingUser } = useAuthUser();
	const login = useLogin();
	const pickableSites = usePickableWpcomSites( { enabled: Boolean( user ) } );
	const [ selectedSiteId, setSelectedSiteId ] = useState< number | null >( null );
	const [ searchQuery, setSearchQuery ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );
	const [ isConnecting, setIsConnecting ] = useState( false );
	const sites = useMemo( () => pickableSites.data ?? [], [ pickableSites.data ] );
	const filteredSites = useMemo( () => {
		const query = searchQuery.trim().toLowerCase();
		if ( ! query ) {
			return sites;
		}
		return sites.filter( ( candidate ) =>
			[ candidate.name, candidate.url ].some( ( value ) => value.toLowerCase().includes( query ) )
		);
	}, [ sites, searchQuery ] );
	const selectedSite = sites.find( ( candidate ) => candidate.id === selectedSiteId ) ?? null;
	const isLoadingSites = Boolean( user ) && pickableSites.isLoading;
	const isBusy = isConnecting || login.isPending;

	useEffect( () => {
		if ( selectedSiteId && ! sites.some( ( candidate ) => candidate.id === selectedSiteId ) ) {
			setSelectedSiteId( null );
		}
	}, [ selectedSiteId, sites ] );

	useEffect( () => {
		if ( ! selectedSiteId && sites.length === 1 ) {
			setSelectedSiteId( sites[ 0 ].id );
		}
	}, [ selectedSiteId, sites ] );

	const handleClose = () => {
		if ( isBusy ) {
			return;
		}
		onClose();
	};

	const handleConnect = async () => {
		if ( ! selectedSite || isConnecting ) {
			return;
		}
		setError( null );
		setIsConnecting( true );
		try {
			await connector.connectWpcomSite( site.id, {
				...selectedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await onConnected();
			setIsConnecting( false );
			onClose();
		} catch ( connectError ) {
			console.error( 'Failed to connect WordPress.com site:', connectError );
			setError( __( 'Unable to connect this site. Please try again.' ) );
			setIsConnecting( false );
		}
	};

	return (
		<Dialog
			ariaLabel={ __( 'Connect a live site' ) }
			className={ styles.connectDialog }
			onClose={ handleClose }
			open
			size="default"
		>
			<DialogHeader>
				<DialogTitle>{ __( 'Connect a live site' ) }</DialogTitle>
				<DialogCloseButton onClose={ handleClose } />
			</DialogHeader>
			<DialogContent className={ styles.connectDialogContent }>
				{ isLoadingUser ? (
					<div className={ styles.connectLoading }>
						<LoadingPlaceholder text={ __( 'Checking WordPress.com account' ) } />
					</div>
				) : user ? (
					<>
						<div className={ styles.connectSearchRow }>
							<input
								className={ styles.connectSearchInput }
								type="search"
								value={ searchQuery }
								placeholder={ __( 'Search sites' ) }
								aria-label={ __( 'Search WordPress.com sites' ) }
								onChange={ ( event ) => setSearchQuery( event.target.value ) }
							/>
							<Button
								variant="quiet"
								size="small"
								label={ __( 'Refresh site list' ) }
								disabled={ pickableSites.isFetching || isConnecting }
								onClick={ pickableSites.refetch }
							>
								{ pickableSites.isFetching ? __( 'Refreshing...' ) : __( 'Refresh' ) }
							</Button>
						</div>
						<div className={ styles.connectSitesPanel }>
							<ConnectSitesContent
								error={ pickableSites.error }
								filteredSites={ filteredSites }
								isLoading={ isLoadingSites }
								searchQuery={ searchQuery }
								selectedSiteId={ selectedSiteId }
								onSelectSite={ setSelectedSiteId }
							/>
						</div>
					</>
				) : (
					<div className={ styles.connectAuthPrompt }>
						<p>{ __( 'Log in with WordPress.com to choose from your sites.' ) }</p>
						<Button
							variant="filled"
							tone="primary"
							size="medium"
							label={ __( 'Log in with WordPress.com' ) }
							disabled={ login.isPending }
							onClick={ () => {
								setError( null );
								login.mutate( undefined, {
									onError: () => {
										setError( __( 'Unable to start WordPress.com login. Please try again.' ) );
									},
								} );
							} }
						>
							{ login.isPending ? __( 'Logging in...' ) : __( 'Log in with WordPress.com' ) }
						</Button>
					</div>
				) }
				{ error ? <DialogError>{ error }</DialogError> : null }
			</DialogContent>
			<DialogFooter className={ styles.connectFooter }>
				<Button
					className={ styles.createLiveSiteButton }
					variant="quiet"
					size="medium"
					icon={ plus }
					label={ __( 'Create a new WordPress.com site' ) }
					disabled={ isBusy || ! canCreateNew }
					onClick={ onCreateNew }
				>
					{ __( 'Create a new WordPress.com site' ) }
				</Button>
				<div className={ styles.connectFooterActions }>
					<Button
						variant="quiet"
						size="medium"
						label={ __( 'Cancel' ) }
						disabled={ isBusy }
						onClick={ handleClose }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="filled"
						tone="primary"
						size="medium"
						label={ __( 'Connect selected site' ) }
						disabled={ ! user || ! selectedSite || isBusy }
						aria-busy={ isConnecting ? 'true' : undefined }
						onClick={ handleConnect }
					>
						{ isConnecting ? __( 'Connecting...' ) : __( 'Connect' ) }
					</Button>
				</div>
			</DialogFooter>
		</Dialog>
	);
}

function ConnectSitesContent( {
	error,
	filteredSites,
	isLoading,
	onSelectSite,
	searchQuery,
	selectedSiteId,
}: {
	error: unknown;
	filteredSites: SyncSite[];
	isLoading: boolean;
	onSelectSite: ( siteId: number ) => void;
	searchQuery: string;
	selectedSiteId: number | null;
} ) {
	if ( isLoading ) {
		return (
			<div className={ styles.connectLoading }>
				<LoadingPlaceholder text={ __( 'Loading your sites' ) } />
				<LoadingPlaceholder />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className={ styles.connectEmptyState }>
				{ __( 'Unable to load WordPress.com sites.' ) }
			</div>
		);
	}

	if ( filteredSites.length === 0 ) {
		return (
			<div className={ styles.connectEmptyState }>
				{ searchQuery
					? __( 'No sites match your search.' )
					: __( 'No WordPress.com sites are available to connect.' ) }
			</div>
		);
	}

	return (
		<List className={ styles.connectSitesList }>
			{ filteredSites.map( ( candidate ) => (
				<ListItem
					key={ candidate.id }
					active={ candidate.id === selectedSiteId }
					description={ getConnectSiteDescription( candidate ) }
					label={ candidate.name || stripProtocol( candidate.url ) }
					onClick={ () => onSelectSite( candidate.id ) }
				/>
			) ) }
		</List>
	);
}

function getConnectSiteDescription( site: SyncSite ) {
	const provider = site.isPressable ? __( 'Pressable' ) : __( 'WordPress.com' );
	const environment = site.isStaging ? __( 'Staging' ) : __( 'Production' );
	return `${ stripProtocol( site.url ) } - ${ provider } - ${ environment }`;
}

function DetailsRow( {
	label,
	status,
	statusText,
	actions,
}: {
	label: string;
	status: SiteStatusTone;
	statusText: ReactNode;
	actions: ReactNode;
} ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				<div className={ styles.rowLabel }>{ label }</div>
				<StatusLine tone={ status }>{ statusText }</StatusLine>
			</div>
			<div className={ styles.rowActions }>{ actions }</div>
		</div>
	);
}

function OpenButton( {
	label,
	disabled,
	onClick,
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
} ) {
	return (
		<Button
			className={ styles.openButton }
			variant="filled"
			size="small"
			icon={ external }
			label={ label }
			disabled={ disabled }
			onClick={ onClick }
		>
			{ __( 'Open' ) }
		</Button>
	);
}

type SiteStatusTone = 'running' | 'transitioning' | 'stopped';

function StatusLine( { tone, children }: { tone: SiteStatusTone; children: ReactNode } ) {
	return (
		<div className={ styles.statusLine }>
			<span
				className={ clsx( styles.statusDot, styles[ `statusDot_${ tone }` ] ) }
				aria-hidden="true"
			/>
			<span className={ styles.statusText }>{ children }</span>
		</div>
	);
}

function SiteBadge( {
	site,
	size,
	status,
}: {
	site: SiteDetails;
	size: 'panel';
	status?: SiteStatusTone;
} ) {
	const hasSiteIcon = Boolean( site.siteIcon );
	const content = hasSiteIcon ? (
		<SiteIcon
			className={ styles.siteBadgeImage }
			seed={ getSiteIconSeed( site ) }
			imageSrc={ site.siteIcon }
		/>
	) : (
		<span className={ styles.siteInitials }>{ getSiteInitials( site.name ) }</span>
	);

	return (
		<span
			className={ clsx( styles.siteBadge, styles[ `siteBadge_${ size }` ] ) }
			aria-hidden="true"
		>
			{ content }
			{ status ? (
				<span className={ clsx( styles.badgeStatus, styles[ `badgeStatus_${ status }` ] ) } />
			) : null }
		</span>
	);
}

function getSiteIconSeed( site: SiteDetails ) {
	return `${ site.id }:${ site.name }:${ site.path }`;
}

function getSiteInitials( name: string ) {
	const words = name.trim().split( /\s+/ ).filter( Boolean );
	const initials =
		words.length >= 2
			? `${ words[ 0 ].charAt( 0 ) }${ words[ 1 ].charAt( 0 ) }`
			: words[ 0 ]?.slice( 0, 2 );
	return ( initials || 'S' ).toUpperCase();
}

function getHeaderStatusText( status: SiteStatusTone, site: SiteDetails ) {
	if ( status === 'transitioning' ) {
		return site.running ? __( 'Stopping site' ) : __( 'Starting site' );
	}
	return site.running ? __( 'Running on localhost' ) : __( 'Stopped' );
}

function getLocalStatusText( status: SiteStatusTone, site: SiteDetails ) {
	if ( status === 'transitioning' ) {
		return site.running ? __( 'Stopping...' ) : __( 'Starting...' );
	}
	if ( site.running ) {
		return site.customDomain
			? sprintf(
					/* translators: %s: the local custom domain for the site. */
					__( 'Running at %s' ),
					getSiteDisplayUrl( site )
			  )
			: __( 'Running on localhost' );
	}
	return __( 'Stopped' );
}

function getServerButtonLabel( isRunning: boolean, isStarting: boolean, isStopping: boolean ) {
	if ( isStarting ) {
		return __( 'Starting...' );
	}
	if ( isStopping ) {
		return __( 'Stopping...' );
	}
	return isRunning ? __( 'Stop' ) : __( 'Start' );
}

function formatRelativeTimestamp( timestamp: number ) {
	return formatRelativeTime( new Date( timestamp ).toISOString() );
}
