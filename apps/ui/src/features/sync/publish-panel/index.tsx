import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import { getConnectMethod, getProviderSites, type SitesProviderId } from '@studio/providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import {
	accountSitesQueryKey,
	remoteSitesQueryKey,
	useAccountSites,
	usePickableSites,
	useProviderConnected,
	useRemoteSites,
} from '@/data/queries/use-remote-sites';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useCancelSync, useDisconnectRemoteSite } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import {
	clearPublishSetupError,
	retryPublishSetup,
	usePublishSetupError,
} from '@/features/sync/use-sync-connect-site-listener';
import { useOffline } from '@/lib/hooks';
import { GlobeIcon, RefreshIcon, SyncIcon } from '@/lib/icons';
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
import { ConnectAccount } from './connect-account';
import { ConnectedView } from './connected-view';
import { ConnectedWebsite } from './connected-website';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { siteAddress, type PanelRequest, type PublishView, type Website } from './options';
import { ErrorMessage, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function PublishPanel( {
	provider,
	site,
	open,
	request,
	headerContainer,
	onSubstepChange,
	onDisconnected,
	setupAfterSignup = false,
	onSetupAfterSignup,
}: {
	provider: SitesProviderId;
	site: SiteDetails;
	open: boolean;
	headerContainer: HTMLDivElement | null;
	onSubstepChange: ( active: boolean ) => void;
	onDisconnected: () => void;
	request?: PanelRequest;
	setupAfterSignup?: boolean;
	onSetupAfterSignup?: () => void;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const offline = useOffline();
	const sites = getProviderSites( provider );
	const accountConnected = useProviderConnected( provider );
	const connected = useRemoteSites( provider, site.id );
	const [ view, setView ] = useState< PublishView | 'choose-site' | 'start' >( 'publish' );
	const [ reviewingTransfer, setReviewingTransfer ] = useState( false );
	const [ disconnecting, setDisconnecting ] = useState< Website | null >( null );
	const disconnectActions = useRef< HTMLButtonElement >( null );
	const [ highlightedSite, setHighlightedSite ] = useState< string >();
	const [ selectedId, setSelectedId ] = useState< Website[ 'id' ] | null >( null );
	// The websites already connected when the user went to create a new one.
	const [ waitingFor, setWaitingFor ] = useState< Website[ 'id' ][] | null >( null );
	const activity = useSiteSyncActivity( site.id );
	// Activity reported before Spacefast names no provider: it was WordPress.com.
	const transfer =
		( activity?.direction === 'push' || activity?.direction === 'pull' ) &&
		( activity.provider ?? 'wpcom' ) === provider
			? activity
			: null;
	const pending = transfer?.kind === 'pending';
	const [ dismissedTransfer, setDismissedTransfer ] = useState< typeof transfer >( null );
	const siteBusy = useIsSiteBusy( site );
	const connections = useMemo< Website[] >( () => connected.data ?? [], [ connected.data ] );
	const syncable = useAccountSites( provider, {
		enabled: open && ! offline,
	} );
	const pickable = usePickableSites( provider, { enabled: open && ! offline } );
	const loading =
		accountConnected === undefined ||
		connected.isPending ||
		( ! pending && connections.length > 0 && ! offline && syncable.isPending );
	const websites: Website[] = syncable.data
		? sites.withDetails( connections, syncable.data )
		: connections;
	// The website created at checkout shows up as a new connection.
	const created = waitingFor
		? connections.find( ( website ) => ! waitingFor.includes( website.id ) )
		: undefined;
	const operationId = transfer?.kind === 'pending' ? transfer.remoteSiteId : undefined;
	const destination =
		websites.find( ( website ) => website.id === ( operationId ?? created?.id ?? selectedId ) ) ??
		websites[ 0 ];
	const checkoutError = usePublishSetupError( site.id );
	const setupError = sites.newSite === 'checkout' ? checkoutError : undefined;
	const setupErrorMessage = (
		<ErrorMessage error={ setupError } retry={ () => retryPublishSetup( site.id ) } />
	);
	const accessIssue =
		destination && syncable.data?.every( ( website ) => website.id !== destination.id )
			? __( 'This website is no longer available to this account. Choose another website.' )
			: undefined;

	const cancel = useCancelSync();
	const disconnect = useDisconnectRemoteSite();
	const invalidateConnections = () => {
		void queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, site.id ) } );
		void queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( provider ) } );
	};
	const showConnected = ( remote: Website ) => {
		void connector.trackEvent(
			TRACKS_EVENTS.SYNC_CONNECT,
			{
				success: true,
				num_of_sites: connections.length + 1,
				sync_type: getSyncType( remote, provider ),
			},
			site.id
		);
		invalidateConnections();
		selectWebsite( remote.id );
		setView( 'publish' );
	};
	const connect = useMutation( {
		mutationFn: ( remote: Website ) =>
			connector.connectRemoteSite( provider, site.id, remote as never ),
		onSuccess: ( _result, remote ) => showConnected( remote ),
	} );
	// A provider that creates sites from Studio names the new one after the local site.
	const create = useMutation( {
		mutationFn: () => connector.createRemoteSite( provider, site.id, site.name ),
		onSuccess: ( remote ) => {
			void queryClient.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
			showConnected( remote );
		},
	} );
	const startCheckout = useCallback( () => {
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
	const startSetup = () => {
		if ( sites.newSite === 'create' ) {
			create.mutate();
		} else {
			startCheckout();
		}
	};
	const selectWebsite = ( id: Website[ 'id' ] | null ) => {
		if ( id !== destination?.id && ! pending ) setDismissedTransfer( transfer );
		setSelectedId( id );
		setWaitingFor( null );
	};
	const busy =
		siteBusy ||
		activity?.kind === 'pending' ||
		connect.isPending ||
		create.isPending ||
		disconnect.isPending;

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
		if ( setupAfterSignup && accountConnected && connected.isSuccess ) {
			onSetupAfterSignup?.();
			if ( ! connections.length && sites.newSite === 'checkout' ) {
				startCheckout();
			}
		}
	}, [
		setupAfterSignup,
		onSetupAfterSignup,
		accountConnected,
		connected.isSuccess,
		connections.length,
		sites.newSite,
		startCheckout,
	] );

	const availableWebsites = pickable.isLoading || pickable.error ? [] : pickable.data ?? [];
	const selectableWebsites = [ ...websites, ...availableWebsites ].filter(
		( website, index, all ) =>
			! sites.issue( website, 'pull' ) &&
			all.findIndex( ( item ) => item.id === website.id ) === index
	);
	const connectedWebsite = (
		<>
			{ setupErrorMessage }
			<ErrorMessage
				error={ connect.error || create.error || ( setupError ? undefined : pickable.error ) }
				retry={ () => {
					connect.reset();
					create.reset();
					disconnect.reset();
					pickable.refetch();
				} }
			/>
			{ destination ? (
				<ConnectedWebsite
					provider={ provider }
					open={ open }
					website={ destination }
					disabled={ offline || busy }
					actionsRef={ disconnectActions }
					onDisconnect={ () => {
						disconnect.reset();
						setDisconnecting( destination );
					} }
				/>
			) : null }
		</>
	);

	const chooseWebsite = ( remote: Website ) => {
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

	const renderContent = () => {
		if ( view === 'choose-site' ) {
			return (
				<>
					{ headerContainer
						? createPortal(
								<PanelHeader
									className={ styles.pickerHeader }
									title={ __( 'Choose an existing site' ) }
									onBack={ () => setView( 'start' ) }
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
											description: siteAddress( remote ),
											trailing: (
												<span className={ styles.environmentLabel }>
													{ sites.describe( remote ).details[ 0 ]?.value }
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
		const loadError = connected.error || ( connections.length ? syncable.error : null );
		if ( ! pending && loadError ) {
			return (
				<>
					<PanelHeader title={ __( 'Publish' ) } />
					<PanelBody insetTop>
						<div className={ styles.reload }>
							<Button
								onClick={ () => {
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
					provider={ provider }
					remote={ destination }
					connectedWebsite={ connectedWebsite }
					activity={
						transfer === dismissedTransfer ||
						( transfer?.remoteSiteId !== undefined && transfer.remoteSiteId !== destination.id )
							? null
							: transfer
					}
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
					<Button
						variant="accent"
						size="lg"
						disabled={ offline || busy }
						loading={ create.isPending }
						onClick={ startSetup }
					>
						{ sites.newSite === 'create' ? __( 'New site' ) : __( 'New site…' ) }
					</Button>
				</div>
			</PanelBody>
		);
	};

	// WordPress.com's account is the Studio sign-in, which the dialog asks for.
	if ( accountConnected === false && getConnectMethod( provider ).kind === 'redirect' ) return null;
	if ( accountConnected === false ) {
		return <ConnectAccount provider={ provider } />;
	}

	return (
		<div className={ styles.content } data-choosing-site={ view === 'choose-site' || undefined }>
			{ ! loading && ( view === 'start' || ( view === 'publish' && ! destination ) ) ? (
				<EmptyHeader className={ styles.emptyIntro }>
					<EmptyMedia className={ styles.emptyIcon }>
						<SyncIcon width="40" height="40" aria-hidden="true" />
					</EmptyMedia>
					<h2 className={ styles.emptyTitle }>{ sites.intro.title() }</h2>
					<EmptyDescription className={ styles.emptyDescription }>
						{ sites.intro.description() }{ ' ' }
						<Button
							variant="inline-accent"
							size="inline"
							onClick={ () => void connector.openExternalUrl( sites.intro.learnMoreUrl ) }
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
					address={ siteAddress( disconnecting ) }
					disabled={ offline || siteBusy || Boolean( pending ) }
					pending={ disconnect.isPending }
					error={ disconnect.error }
					returnFocus={ disconnectActions }
					onClose={ () => setDisconnecting( null ) }
					onConfirm={ () => {
						void connector.trackEvent( TRACKS_EVENTS.SYNC_DISCONNECT, {
							sync_type: getSyncType( disconnecting, provider ),
						} );
						disconnect.mutate(
							{ provider, siteId: site.id, remoteSiteId: disconnecting.id },
							{
								onSuccess: () => {
									setDisconnecting( null );
									onDisconnected();
								},
							}
						);
					} }
				/>
			) : null }
		</div>
	);
}
