import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { withWpcomDetails } from '@studio/common/lib/sync/transform-sites';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	connectedWpcomSitesQueryKey,
	useConnectedWpcomSites,
} from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useCancelSync, useDisconnectWpcomSite } from '@/data/queries/use-sync-site';
import { usePickableWpcomSites, useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { ALL_CONNECTED_WPCOM_SITES_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { useSiteSyncActivity } from '@/data/sync-activity';
import {
	clearPublishSetupError,
	retryPublishSetup,
	usePublishSetupError,
} from '@/features/sync/use-sync-connect-site-listener';
import { useOffline } from '@/lib/hooks';
import { GlobeIcon, RefreshIcon } from '@/lib/icons';
import {
	Button,
	IconButton,
	Menu,
	CommandList,
	Spinner,
	EmptyHeader,
	EmptyMedia,
	EmptyDescription,
} from '@/lib/ui';
import { ConnectedView } from './connected-view';
import { ConnectedWebsite } from './connected-website';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { websiteAddress, websiteEnvironmentLabel, websiteIssue, type PublishView } from './options';
import { ErrorMessage, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import type { SiteDetails, SyncSite } from '@/data/core';

export function PublishPanel( {
	site,
	open,
	request,
	headerContainer,
	onSubstepChange,
	setupAfterSignup = false,
	onSetupAfterSignup,
}: {
	site: SiteDetails;
	open: boolean;
	headerContainer: HTMLDivElement | null;
	onSubstepChange: ( active: boolean ) => void;
	request?: { view: PublishView; remoteSiteId?: number };
	setupAfterSignup?: boolean;
	onSetupAfterSignup?: () => void;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const offline = useOffline();
	const user = useAuthUser();
	const connected = useConnectedWpcomSites( site.id );
	const [ view, setView ] = useState< PublishView | 'choose-site' | 'start' >( 'publish' );
	const [ reviewingTransfer, setReviewingTransfer ] = useState( false );
	const [ disconnecting, setDisconnecting ] = useState< SyncSite | null >( null );
	const disconnectActions = useRef< HTMLButtonElement >( null );
	const websiteSwitcher = useRef< HTMLButtonElement >( null );
	const [ highlightedSite, setHighlightedSite ] = useState< string >();
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	// The websites already connected when the user went to create a new one.
	const [ waitingFor, setWaitingFor ] = useState< number[] | null >( null );
	const activity = useSiteSyncActivity( site.id );
	const transfer =
		activity?.direction === 'push' || activity?.direction === 'pull' ? activity : null;
	const pending = transfer?.kind === 'pending';
	const [ dismissedTransfer, setDismissedTransfer ] = useState< typeof transfer >( null );
	const siteBusy = useIsSiteBusy( site );
	const signedOut = user.isSuccess && ! user.data;
	const connections = useMemo( () => connected.data ?? [], [ connected.data ] );
	const syncable = useSyncableWpcomSites( {
		enabled: open && ! offline,
	} );
	const pickable = usePickableWpcomSites( { enabled: open && ! offline } );
	const loading =
		user.isPending ||
		connected.isPending ||
		( ! pending && connections.length > 0 && ! offline && syncable.isPending );
	const websites = syncable.data ? withWpcomDetails( connections, syncable.data ) : connections;
	// The website created at checkout shows up as a new connection.
	const created = waitingFor
		? connections.find( ( website ) => ! waitingFor.includes( website.id ) )
		: undefined;
	const operationId = transfer?.kind === 'pending' ? transfer.remoteSiteId : undefined;
	const destination =
		websites.find( ( website ) => website.id === ( operationId ?? created?.id ?? selectedId ) ) ??
		websites[ 0 ];
	const setupError = usePublishSetupError( site.id );
	const setupErrorMessage = (
		<ErrorMessage error={ setupError } retry={ () => retryPublishSetup( site.id ) } />
	);
	const accessIssue =
		destination && syncable.data?.every( ( website ) => website.id !== destination.id )
			? __( 'This website is no longer available to this account. Choose another website.' )
			: undefined;

	const cancel = useCancelSync();
	const disconnect = useDisconnectWpcomSite();
	const connect = useMutation( {
		mutationFn: ( remote: SyncSite ) =>
			connector.connectWpcomSite( site.id, {
				...remote,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} ),
		onSuccess: ( _result, remote ) => {
			void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
				success: true,
				num_of_sites: connections.length + 1,
			} );
			void queryClient.invalidateQueries( { queryKey: connectedWpcomSitesQueryKey( site.id ) } );
			void queryClient.invalidateQueries( { queryKey: ALL_CONNECTED_WPCOM_SITES_QUERY_KEY } );
			selectWebsite( remote.id );
			setView( 'publish' );
		},
	} );
	const startSetup = useCallback( () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( ! checkoutUrl ) {
			return;
		}
		clearPublishSetupError( site.id );
		setWaitingFor( connections.map( ( website ) => website.id ) );
		void connector.trackEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE );
		void connector.watchForPublishedSite?.( site.id );
		void connector.openExternalUrl( checkoutUrl );
	}, [ connections, connector, site ] );
	const selectWebsite = ( id: number | null ) => {
		if ( id !== destination?.id && ! pending ) setDismissedTransfer( transfer );
		setSelectedId( id );
		setWaitingFor( null );
	};
	const busy =
		siteBusy || activity?.kind === 'pending' || connect.isPending || disconnect.isPending;

	useEffect( () => {
		if ( request ) {
			setView( request.view );
			setSelectedId( request.remoteSiteId ?? null );
			setWaitingFor( null );
		}
	}, [ request ] );

	// Checkout and existing-site selection return to the same connected view.
	const createdId = created?.id;
	useEffect( () => {
		if ( createdId !== undefined ) {
			setView( 'publish' );
		}
	}, [ createdId ] );

	// Someone who just created an account has no website yet: take them to checkout.
	useEffect( () => {
		if ( setupAfterSignup && user.data && connected.isSuccess ) {
			onSetupAfterSignup?.();
			if ( ! connections.length ) {
				startSetup();
			}
		}
	}, [
		setupAfterSignup,
		onSetupAfterSignup,
		user.data,
		connected.isSuccess,
		connections.length,
		startSetup,
	] );

	const availableWebsites = pickable.isLoading || pickable.error ? [] : pickable.data ?? [];
	const selectableWebsites = [ ...websites, ...availableWebsites ].filter(
		( website, index, all ) =>
			! websiteIssue( website ) && all.findIndex( ( item ) => item.id === website.id ) === index
	);
	const connectedWebsite = (
		<>
			{ setupErrorMessage }
			<ErrorMessage
				error={ connect.error || ( setupError ? undefined : pickable.error ) }
				retry={ () => {
					connect.reset();
					disconnect.reset();
					pickable.refetch();
				} }
			/>
			{ destination ? (
				<ConnectedWebsite
					open={ open }
					website={ destination }
					websites={ websites }
					onSelectWebsite={ selectWebsite }
					onConnectWebsite={ () => setView( 'choose-site' ) }
					disabled={ offline || busy }
					actionsRef={ disconnectActions }
					switcherRef={ websiteSwitcher }
					onDisconnect={ () => {
						disconnect.reset();
						setDisconnecting( destination );
					} }
				/>
			) : null }
		</>
	);

	const chooseWebsite = ( remote: SyncSite ) => {
		if ( connections.some( ( website ) => website.id === remote.id ) ) {
			selectWebsite( remote.id );
			setView( 'publish' );
		} else {
			connect.mutate( remote );
		}
	};

	useEffect( () => {
		onSubstepChange( view === 'choose-site' || reviewingTransfer );
	}, [ view, reviewingTransfer, onSubstepChange ] );

	const destinationId = destination?.id;
	useEffect( () => {
		if ( selectedId === null ) return;
		const frame = requestAnimationFrame( () => websiteSwitcher.current?.focus() );
		return () => cancelAnimationFrame( frame );
	}, [ selectedId, destinationId ] );

	const renderContent = () => {
		if ( view === 'choose-site' ) {
			return (
				<>
					{ headerContainer
						? createPortal(
								<PanelHeader
									className={ styles.pickerHeader }
									title={ __( 'Choose an existing site' ) }
									onBack={ () => setView( destination ? 'publish' : 'start' ) }
								>
									{ selectableWebsites.length ? (
										<Menu.Root modal={ false }>
											<Menu.Trigger
												render={
													<IconButton
														className={ styles.pickerMenu }
														variant="outline"
														size="icon-sm"
														icon={ <EllipsisIcon /> }
														label={ __( 'Site actions' ) }
													/>
												}
											/>
											<Menu.Popup side="right" align="start">
												<Menu.Item
													disabled={ offline || busy || pickable.isFetching }
													onClick={ () => void pickable.refetch() }
												>
													<RefreshIcon />
													{ __( 'Refresh' ) }
												</Menu.Item>
											</Menu.Popup>
										</Menu.Root>
									) : null }
								</PanelHeader>,
								headerContainer
						  )
						: null }
					<PanelBody>
						<ErrorMessage
							error={ connect.error || pickable.error }
							retry={ () => {
								connect.reset();
								void pickable.refetch();
							} }
						/>
						{ pickable.isLoading ? (
							<div className={ styles.pickerEmpty }>
								<Spinner aria-label={ __( 'Loading websites…' ) } />
							</div>
						) : selectableWebsites.length ? (
							<CommandList
								label={ __( 'Existing sites' ) }
								radius="control"
								size="default"
								className={ styles.siteList }
								groups={ [
									{
										label: __( 'Sites' ),
										items: selectableWebsites.map( ( remote ) => ( {
											value: String( remote.id ),
											label: remote.name || remote.url,
											description: websiteAddress( remote ),
											trailing: (
												<span className={ styles.environmentLabel }>
													{ websiteEnvironmentLabel( remote ) }
												</span>
											),
											icon: GlobeIcon,
											disabled: busy || offline,
										} ) ),
									},
								] }
								highlighted={ highlightedSite }
								onHighlight={ setHighlightedSite }
								onSelect={ ( value ) => {
									const remote = selectableWebsites.find( ( item ) => String( item.id ) === value );
									if ( remote ) chooseWebsite( remote );
								} }
							/>
						) : ! pickable.error ? (
							<div className={ styles.pickerEmpty }>
								<p className={ styles.text }>{ __( 'No existing sites.' ) }</p>
								<Button
									variant="outline"
									disabled={ offline || busy || pickable.isFetching }
									onClick={ () => void pickable.refetch() }
								>
									{ __( 'Refresh' ) }
								</Button>
							</div>
						) : null }
					</PanelBody>
				</>
			);
		}

		if ( pending && ! destination ) {
			return (
				<>
					<PanelHeader
						title={ transfer.direction === 'pull' ? __( 'Pull changes' ) : __( 'Publish' ) }
					/>
					<PanelBody insetTop>
						<TransferProgress
							siteId={ site.id }
							activity={ transfer }
							cancel={ () =>
								transfer.remoteSiteId !== undefined &&
								cancel.mutate( { siteId: site.id, remoteSiteId: transfer.remoteSiteId } )
							}
							cancelling={ cancel.isPending }
						/>
					</PanelBody>
				</>
			);
		}
		if ( loading ) {
			return (
				<>
					<PanelHeader title={ __( 'Publish' ) } />
					<PanelBody insetTop loading />
				</>
			);
		}
		const loadError =
			user.error || connected.error || ( connections.length ? syncable.error : null );
		if ( ! pending && loadError ) {
			return (
				<>
					<PanelHeader title={ __( 'Publish' ) } />
					<PanelBody insetTop>
						<div className={ styles.reload }>
							<Button
								onClick={ () => {
									void user.refetch();
									void connected.refetch();
									void syncable.refetch();
								} }
							>
								{ __( 'Reload' ) }
							</Button>
						</div>
					</PanelBody>
				</>
			);
		}
		if ( destination && view !== 'start' ) {
			return (
				<ConnectedView
					key={ destination.id }
					site={ site }
					remote={ destination }
					connectedWebsite={ connectedWebsite }
					activity={ transfer === dismissedTransfer ? null : transfer }
					view={ view }
					setView={ setView }
					open={ open }
					disabled={ busy || offline }
					offline={ offline }
					accessIssue={ accessIssue }
					headerContainer={ headerContainer }
					onReviewingChange={ setReviewingTransfer }
				/>
			);
		}
		return (
			<PanelBody insetTop>
				{ offline ? (
					<p className={ styles.text }>{ __( 'Connect to the internet to publish your site.' ) }</p>
				) : null }
				{ setupErrorMessage }
				<div className={ styles.introActions }>
					<Button
						variant="outline"
						size="lg"
						disabled={ offline || busy }
						onClick={ () => setView( 'choose-site' ) }
					>
						{ __( 'Existing site…' ) }
					</Button>
					<Button size="lg" disabled={ offline || busy } onClick={ startSetup }>
						{ __( 'New site…' ) }
					</Button>
				</div>
			</PanelBody>
		);
	};

	if ( signedOut ) return null;

	return (
		<div className={ styles.content } data-choosing-site={ view === 'choose-site' || undefined }>
			{ ! loading && ( view === 'start' || ( view === 'publish' && ! destination ) ) ? (
				<EmptyHeader className={ styles.emptyIntro }>
					<EmptyMedia className={ styles.emptyIcon }>
						<GlobeIcon width="40" height="40" aria-hidden="true" />
					</EmptyMedia>
					<h2 className={ styles.emptyTitle }>{ __( 'Publish your WordPress' ) }</h2>
					<EmptyDescription className={ styles.emptyDescription }>
						{ __(
							'Publish to a new site and choose a domain, or use an existing site on WordPress.com or Pressable.'
						) }{ ' ' }
						<Button
							variant="inline-accent"
							size="inline"
							onClick={ () =>
								void connector.openExternalUrl(
									'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
								)
							}
						>
							{ __( 'Learn more…' ) }
						</Button>
					</EmptyDescription>
				</EmptyHeader>
			) : null }
			{ renderContent() }
			{ disconnecting ? (
				<DisconnectSiteDialog
					website={ disconnecting }
					disabled={ offline || siteBusy || Boolean( pending ) }
					pending={ disconnect.isPending }
					error={ disconnect.error }
					returnFocus={ disconnectActions }
					onClose={ () => setDisconnecting( null ) }
					onConfirm={ () => {
						void connector.trackEvent( TRACKS_EVENTS.SYNC_DISCONNECT );
						disconnect.mutate(
							{ siteId: site.id, remoteSiteId: disconnecting.id },
							{
								onSuccess: () => {
									setDisconnecting( null );
									selectWebsite( null );
									setView( websites.length > 1 ? 'publish' : 'choose-site' );
									void queryClient.invalidateQueries( {
										queryKey: ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
									} );
								},
							}
						);
					} }
				/>
			) : null }
		</div>
	);
}
