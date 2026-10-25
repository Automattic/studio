import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { withWpcomDetails } from '@studio/common/lib/sync/transform-sites';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	connectedWpcomSitesQueryKey,
	useConnectedWpcomSites,
} from '@/data/queries/use-connected-wpcom-sites';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { useCancelSync, useDisconnectWpcomSite } from '@/data/queries/use-sync-site';
import { usePickableWpcomSites, useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { AccountPromptDialog } from '@/features/account';
import {
	clearPublishSetupError,
	retryPublishSetup,
	usePublishSetupError,
} from '@/features/sync/use-sync-connect-site-listener';
import { useOffline } from '@/lib/hooks';
import { ExternalLinkIcon, PublishTransferIcon } from '@/lib/icons';
import { Popover, Button } from '@/lib/ui';
import { ConnectedView } from './connected-view';
import { websiteAddress, websiteIssue, websiteLabel, type PublishView } from './options';
import { ErrorMessage, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import type { SiteDetails, SyncSite } from '@/data/core';

// The header's Publish button and its panel: connect the site to a
// WordPress.com or Pressable website, then publish to it or pull from it.
export function PublishButton( {
	site,
	anchor,
}: {
	site: SiteDetails;
	anchor?: RefObject< HTMLElement | null >;
} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const trigger = useRef< HTMLButtonElement >( null );
	const offline = useOffline();
	const user = useAuthUser();
	const connected = useConnectedWpcomSites( site.id );
	const [ open, setOpen ] = useState( false );
	const [ view, setView ] = useState< PublishView >( 'publish' );
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	// The websites already connected when the user went to create a new one.
	const [ waitingFor, setWaitingFor ] = useState< number[] | null >( null );
	const [ setupAfterSignup, setSetupAfterSignup ] = useState( false );
	const [ recentSuccess, setRecentSuccess ] = useState( false );
	const activity = useSiteSyncActivity( site.id );
	const transfer =
		activity?.direction === 'push' || activity?.direction === 'pull' ? activity : null;
	const pending = transfer?.kind === 'pending';
	const siteBusy = useIsSiteBusy( site );
	const signedOut = user.isSuccess && ! user.data;
	const connections = useMemo( () => connected.data ?? [], [ connected.data ] );
	const syncable = useSyncableWpcomSites( {
		enabled: open && ! offline && ( view === 'pick' || connections.length > 0 ),
	} );
	const pickable = usePickableWpcomSites( { enabled: open && ! offline && view === 'pick' } );
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
	const settingUp = waitingFor !== null && ! created && ! pending && ! setupError;
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
		setSelectedId( id );
		setWaitingFor( null );
	};
	const busy =
		siteBusy || activity?.kind === 'pending' || connect.isPending || disconnect.isPending;

	useEffect(
		() =>
			subscribeHeaderPanelRequest( site.id, 'publish', ( request ) => {
				setView( request.view );
				setSelectedId( request.remoteSiteId ?? null );
				setWaitingFor( null );
				setOpen( true );
			} ),
		[ site.id ]
	);

	// The site created at checkout publishes right away; show its progress.
	const createdId = created?.id;
	useEffect( () => {
		if ( createdId !== undefined ) {
			setView( 'publish' );
		}
	}, [ createdId ] );

	// Someone who just created an account has no website yet: take them to checkout.
	useEffect( () => {
		if ( setupAfterSignup && user.data && connected.isSuccess ) {
			setSetupAfterSignup( false );
			if ( ! connections.length ) {
				startSetup();
			}
		}
	}, [ setupAfterSignup, user.data, connected.isSuccess, connections.length, startSetup ] );

	useEffect( () => {
		if ( transfer?.kind !== 'success' ) {
			return;
		}
		setRecentSuccess( true );
		const timer = setTimeout( () => setRecentSuccess( false ), 1800 );
		return () => clearTimeout( timer );
	}, [ transfer?.kind ] );

	const changeOpen = ( value: boolean ) => {
		setOpen( value );
		if ( ! value ) {
			setView( 'publish' );
		}
	};
	const error = ( transfer?.kind === 'error' ? transfer.message : undefined ) ?? setupError;
	let status: string | undefined;
	if ( pending ) {
		status = transfer.direction === 'push' ? __( 'Publishing…' ) : __( 'Pulling…' );
	} else if ( settingUp ) {
		status = __( 'Setting up…' );
	}

	const renderContent = () => {
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
		if (
			user.isPending ||
			connected.isPending ||
			( ! pending && connections.length > 0 && ! offline && syncable.isPending )
		) {
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
						<ErrorMessage
							error={ loadError }
							retry={ () => {
								void user.refetch();
								void connected.refetch();
								void syncable.refetch();
							} }
						/>
					</PanelBody>
				</>
			);
		}
		if ( view === 'pick' ) {
			return (
				<>
					<PanelHeader
						title={ __( 'Choose website' ) }
						onBack={ () => setView( destination ? 'websites' : 'publish' ) }
					/>
					<PanelBody loading={ pickable.isLoading }>
						<ErrorMessage
							error={ pickable.error || connect.error }
							retry={ () => {
								connect.reset();
								pickable.refetch();
							} }
						/>
						{ pickable.data?.length ? (
							pickable.data.map( ( remote ) => (
								<div key={ remote.id } className={ styles.choice }>
									<Button
										variant="outline"
										layout="row"
										disabled={ offline || busy || Boolean( websiteIssue( remote ) ) }
										onClick={ () => connect.mutate( remote ) }
									>
										<span className={ styles.choiceText }>
											<span className={ styles.choiceName } title={ remote.name || remote.url }>
												{ remote.name || remote.url }
											</span>
											<span
												className={ styles.choiceLabel }
												title={ `${ websiteAddress( remote ) } · ${ websiteLabel( remote ) }` }
											>
												{ websiteAddress( remote ) } · { websiteLabel( remote ) }
											</span>
										</span>
									</Button>
									{ websiteIssue( remote ) ? (
										<p className={ styles.text }>{ websiteIssue( remote ) }</p>
									) : null }
								</div>
							) )
						) : (
							<p className={ styles.text }>
								{ __(
									'No websites are available. You need administrator access to an eligible WordPress.com or Pressable website.'
								) }
							</p>
						) }
						{ offline ? (
							<p className={ styles.text }>
								{ __( 'Connect to the internet to choose a website.' ) }
							</p>
						) : null }
					</PanelBody>
				</>
			);
		}
		if ( view === 'websites' ) {
			return (
				<>
					<PanelHeader title={ __( 'Websites' ) } onBack={ () => setView( 'publish' ) } />
					<PanelBody>
						<ErrorMessage error={ disconnect.error } retry={ () => disconnect.reset() } />
						{ setupErrorMessage }
						{ websites.map( ( remote ) => (
							<div key={ remote.id } className={ styles.websiteRow }>
								<div className={ styles.websiteRowText }>
									<span className={ styles.address } title={ websiteAddress( remote ) }>
										{ websiteAddress( remote ) }
									</span>
									<p className={ styles.text }>{ websiteLabel( remote ) }</p>
								</div>
								<Button
									variant="ghost"
									size="xs"
									disabled={ busy || offline }
									onClick={ () => {
										void connector.trackEvent( TRACKS_EVENTS.SYNC_DISCONNECT );
										disconnect.mutate(
											{ siteId: site.id, remoteSiteId: remote.id },
											{ onSuccess: () => selectWebsite( null ) }
										);
									} }
								>
									{ __( 'Disconnect' ) }
								</Button>
							</div>
						) ) }
						<Button
							variant="outline"
							disabled={ busy || offline }
							onClick={ () => setView( 'pick' ) }
						>
							{ __( 'Use another website…' ) }
						</Button>
						<Button
							variant="inline-text"
							size="inline"
							disabled={ busy || offline || settingUp }
							aria-live="polite"
							onClick={ startSetup }
						>
							{ settingUp ? (
								__( 'Waiting for WordPress.com…' )
							) : (
								<>
									{ __( 'Create a new WordPress.com site' ) }
									<ExternalLinkIcon data-icon="inline-end" />
								</>
							) }
						</Button>
					</PanelBody>
				</>
			);
		}
		if ( destination ) {
			return (
				<ConnectedView
					key={ destination.id }
					site={ site }
					remote={ destination }
					websites={ websites }
					activity={ transfer }
					view={ view }
					setView={ setView }
					selectWebsite={ selectWebsite }
					open={ open }
					disabled={ busy || offline }
					offline={ offline }
					accessIssue={ accessIssue }
				/>
			);
		}
		return (
			<PanelBody insetTop>
				<div className={ styles.intro }>
					<Popover.Title className={ styles.heading }>
						{ __( 'Publish your WordPress' ) }
					</Popover.Title>
					<p className={ styles.description }>
						{ __( 'Choose a domain and hosting plan on WordPress.com to publish your site.' ) }
					</p>
				</div>
				{ offline ? (
					<p className={ styles.text }>{ __( 'Connect to the internet to publish your site.' ) }</p>
				) : null }
				{ setupErrorMessage }
				<div className={ styles.introActions }>
					<Button
						variant={ settingUp ? 'outline' : 'accent' }
						disabled={ offline || busy || settingUp }
						aria-live="polite"
						onClick={ startSetup }
					>
						{ settingUp ? __( 'Waiting for WordPress.com…' ) : __( 'Publish on WordPress.com' ) }
					</Button>
					<Button
						variant="inline-text"
						disabled={ offline || busy }
						onClick={ () => {
							selectWebsite( selectedId );
							setView( 'pick' );
						} }
					>
						{ __( 'Use an existing website…' ) }
					</Button>
				</div>
			</PanelBody>
		);
	};

	return (
		<>
			<Popover.Root open={ open && ! signedOut } onOpenChange={ changeOpen }>
				<Popover.Trigger
					render={
						<Button
							ref={ trigger }
							activeMotion="layout"
							aria-label={ __( 'Publish…' ) }
							aria-description={ error ?? status }
						/>
					}
				>
					{ pending ? (
						<PublishTransferIcon
							direction={ transfer.direction === 'pull' ? 'pull' : 'push' }
							className={ styles.transferIcon }
						/>
					) : recentSuccess ? (
						<CheckIcon />
					) : null }
					<span className={ styles.triggerLabel }>
						{ __( 'Publish' ) }
						{ error ? <span className={ styles.errorDot } /> : null }
					</span>
				</Popover.Trigger>
				<Popover.Popup
					anchor={ anchor }
					side="bottom"
					align="end"
					sideOffset={ 12 }
					alignOffset={ 12 }
					backdrop
					className={ styles.panel }
					finalFocus={ trigger }
				>
					{ renderContent() }
				</Popover.Popup>
			</Popover.Root>
			<AccountPromptDialog
				open={ open && signedOut }
				onOpenChange={ changeOpen }
				finalFocus={ trigger }
				title={ __( 'Publish your WordPress' ) }
				description={ __(
					'Create an account or log in to publish a website and keep your sites in sync.'
				) }
				source="sync_tab"
				onCreateAccount={ () => setSetupAfterSignup( true ) }
			/>
		</>
	);
}
