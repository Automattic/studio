import { getQualifyingLiveSites } from '@studio/common/lib/live-preview-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getProvider, getProviderSites, type SitesProviderId } from '@studio/providers';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector, type SiteDetails, type Snapshot, SyncSite } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	accountSitesQueryKey,
	publishTargetQueryKey,
	remotePublishTargetKey,
	remoteSitesQueryKey,
} from '@/data/queries/use-remote-sites';
import { useSiteVisibility } from '@/data/queries/use-site-visibility';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { usePushSite, useDisconnectRemoteSite } from '@/data/queries/use-sync-site';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { getSnapshotAdminUrl, getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { useOpenSettings } from '@/data/use-open-settings';
import { AccountPromptDialog } from '@/features/account';
import { PreviewManagementDialog, type PreviewManagementAction } from '@/features/sharing';
import { clearPublishSetupError, retryPublishSetup, usePublishSetupError } from '@/features/sync';
import { useOffline } from '@/lib/hooks';
import {
	GlobeIcon,
	PlusIcon,
	PencilIcon,
	RefreshCwIcon,
	WordPressIcon,
	DuplicateIcon,
	EllipsisVerticalIcon,
	ExternalLinkIcon,
	ChevronRightIcon,
	LinkIcon,
	TrashIcon,
	UploadIcon,
} from '@/lib/icons';
import {
	Alert,
	AlertTitle,
	AlertDescription,
	AlertActions,
	Button,
	NotificationDot,
	IconButton,
	Popover,
	Menu,
	Skeleton,
	Spinner,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
	AlertDialog,
	Dialog,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from '@/lib/ui';
import { ConnectSiteIcon, DisconnectSiteIcon } from './connection-icons';
import { DestinationRow } from './destination-row';
import { ExistingSiteDialog } from './existing-site-dialog';
import { HostedAccessControl, PreviewAccessControl } from './hosted-access-control';
import { LiveSiteAction } from './live-site-action';
import { ProviderLogo } from './provider-logo';
import {
	ProviderPicker,
	rememberPublishProvider,
	orderedPublishProviders,
} from './provider-picker';
import { PublishFilesDialog, PublishOptionsControl } from './publish-options-control';
import { PublishedPreviews } from './published-previews';
import { PullPreviewDialog } from './pull-preview-dialog';
import { PullPreviewIcon } from './pull-preview-icon';
import { ShareView } from './share-view';
import styles from './style.module.css';
import { describePublishTarget } from './target-description';
import { TargetSwitcher } from './target-switcher';
import { usePublishPreview } from './use-publish-preview';
import { usePublishTargets, type PublishTarget } from './use-publish-targets';

type PullRequest = { provider?: SitesProviderId; remoteSiteId?: string | number };

type Checkout = {
	provider: SitesProviderId;
	primaryLabel: string;
	url?: string;
};

export function PublishButton( {
	site,
	variant = 'accent',
}: {
	site: SiteDetails;
	variant?: 'accent' | 'outline';
} ) {
	const connector = useConnector();
	const client = useQueryClient();
	const trigger = useRef< HTMLButtonElement >( null );
	const urlRow = useRef< HTMLButtonElement >( null );
	const publishOptionsTrigger = useRef< HTMLButtonElement >( null );
	const anchor = useRef< HTMLSpanElement >( null );
	const cancel = useRef< HTMLButtonElement >( null );
	const [ open, setOpen ] = useState( false );
	const [ pullRequest, setPullRequest ] = useState< PullRequest >();
	const targets = usePublishTargets( site.id, open );
	const user = useAuthUser();
	const accounts = useAiSettings();
	const openSettings = useOpenSettings();
	const accountsReady = user.isSuccess && accounts.isSuccess;
	const connectedProviders = targets.providers.filter( ( provider ) =>
		getProvider( provider ).account.methods.some( ( method ) => method.kind === 'redirect' )
			? !! user.data
			: accounts.data?.accounts[ provider ].connected
	);
	const needsAccount = accountsReady && connectedProviders.length === 0;
	const requestHandler = useRef(
		( _request: {
			provider?: SitesProviderId;
			remoteSiteId?: string | number;
			view?: string;
		} ) => {}
	);
	useEffect( () => {
		requestHandler.current = ( request ) => {
			const target = targets.targets.find(
				( target ) =>
					target.provider === request.provider && target.remote?.id === request.remoteSiteId
			);
			if ( target ) targets.select( target );
			setPullRequest( request.view === 'pull' ? request : undefined );
			setOpen( true );
		};
	} );
	useEffect( () => {
		const share = subscribeHeaderPanelRequest( site.id, 'share', () =>
			requestHandler.current( {} )
		);
		const publish = subscribeHeaderPanelRequest( site.id, 'publish', ( request ) =>
			requestHandler.current( request )
		);
		return () => {
			share();
			publish();
		};
	}, [ site.id ] );
	const selected = targets.selected;
	const snapshot = selected?.snapshot;
	const remote = selected?.remote;
	const descriptor = selected ? getProviderSites( selected.provider ) : undefined;
	const firstPublish = !! remote && ! remote.lastPushTimestamp;
	const newDestination =
		firstPublish &&
		!! remote &&
		'launchAfterPush' in remote &&
		remote.launchAfterPush === true &&
		remote.launchStatus === 'unlaunched';
	const liveSites = getQualifyingLiveSites(
		targets.targets.flatMap( ( target ) =>
			target.remote && getProviderSites( target.provider ).previews
				? [ target.remote as SyncSite ]
				: []
		)
	);
	const preview = usePublishPreview( site, open, targets.selectedPreview?.snapshot );
	const visibility = useSiteVisibility(
		selected?.provider ?? targets.providers[ 0 ],
		remote?.id,
		!! remote && !! descriptor?.visibility?.( remote )
	);
	const remoteUrl = visibility.query.data?.url ?? remote?.url;
	const title = remote ? __( 'Publish' ) : __( 'Share' );
	const activity = useSiteSyncActivity( site.id );
	const setupError = usePublishSetupError( site.id );
	const offline = useOffline();
	const busy = useIsSiteBusy( site );
	const push = usePushSite();
	const disconnect = useDisconnectRemoteSite();
	const [ publishProvider, setPublishProvider ] = useState< SitesProviderId >();
	const emptyDestination =
		( publishProvider && connectedProviders.includes( publishProvider )
			? publishProvider
			: undefined ) ??
		orderedPublishProviders( connectedProviders )[ 0 ] ??
		targets.providers[ 0 ];
	const emptyDescriptor = getProviderSites( emptyDestination );
	const destinationProvider = selected?.provider ?? emptyDestination;
	const connection = targets.connectionState( destinationProvider );
	const connectionUnavailable = ! selected && connection.unavailable;
	const previewsCapability =
		( descriptor ?? emptyDescriptor ).previews ??
		( remote && targets.previewProvider && connectedProviders.includes( targets.previewProvider )
			? getProviderSites( targets.previewProvider ).previews
			: undefined );
	const pullTarget =
		pullRequest &&
		targets.targets.find(
			( target ) =>
				!! target.remote &&
				( ! pullRequest.provider || target.provider === pullRequest.provider ) &&
				( pullRequest.remoteSiteId === undefined ||
					target.remote.id === pullRequest.remoteSiteId ) &&
				getProviderSites( target.provider ).pull
		);
	const showLivePull =
		!! pullTarget?.remote && accountsReady && ! needsAccount && ! targets.loadingConnections;
	const missingPullTarget = !! pullRequest && ! pullTarget && ! targets.loadingConnections;
	const pullKey = pullTarget?.key;
	const pullProvider = pullTarget?.provider;
	const pullRemoteId = pullTarget?.remote?.id;
	useEffect( () => {
		if ( ! pullKey || pullRemoteId === undefined ) return;
		client.setQueryData( publishTargetQueryKey( site.id ), pullKey );
		setPullRequest( ( request ) =>
			request && request.remoteSiteId === undefined
				? { provider: pullProvider, remoteSiteId: pullRemoteId }
				: request
		);
	}, [ client, site.id, pullKey, pullProvider, pullRemoteId ] );
	const emptyDescription = emptyDescriptor.previews
		? __( 'Share a temporary preview, or make your WordPress public.' )
		: __( 'Make your WordPress public with a link anyone can open.' );
	const [ preparing, setPreparing ] = useState< 'checkout' | 'create' >();
	const [ checkout, setCheckout ] = useState< Checkout >();
	const [ publicPreviewKey, setPublicPreviewKey ] = useState< string >();
	const activeCheckout = remote ? undefined : checkout;
	const checkoutUrl = activeCheckout?.url;
	const openingCheckout = !! activeCheckout && ! checkoutUrl && preparing === 'checkout';
	const checkoutInProgress = openingCheckout || !! checkoutUrl;
	const checkoutProvider = activeCheckout && getProvider( activeCheckout.provider ).label;
	const openingDescription = checkoutProvider
		? sprintf(
				/* translators: %s: hosting provider name. */
				__( 'Opening %s' ),
				checkoutProvider
		  )
		: undefined;
	const [ failure, setFailure ] = useState< string >();
	const [ previewLimitOpen, setPreviewLimitOpen ] = useState( false );
	const [ previewsBeforeCreation, setPreviewsBeforeCreation ] = useState< Set< number > >();
	const [ previewAction, setPreviewAction ] = useState< PreviewManagementAction | null >( null );
	const [ removeTarget, setRemoveTarget ] = useState< PublishTarget >();
	const [ pullPreview, setPullPreview ] = useState< {
		snapshot: Snapshot;
		provider: SitesProviderId;
	} >();
	const [ existingProvider, setExistingProvider ] = useState< SitesProviderId >();
	const [ previewLiveSite, setPreviewLiveSite ] = useState< string >();
	const [ republishing, setRepublishing ] = useState( false );
	const [ chooseFiles, setChooseFiles ] = useState( false );
	const openingTargetDialog = !! (
		showLivePull ||
		pullPreview ||
		previewAction ||
		removeTarget ||
		existingProvider ||
		previewLiveSite !== undefined ||
		republishing ||
		chooseFiles
	);
	const locale = useUserLocale();
	const liveTransfer =
		activity?.kind === 'pending' &&
		( activity.direction === 'push' || activity.direction === 'pull' );
	const pending =
		preview.pending ||
		!! previewsBeforeCreation ||
		!! preparing ||
		push.isPending ||
		activity?.kind === 'pending';
	const disabled = pending || offline || busy || ( ! selected && connection.loading );
	const canRequestPreview = preview.canCreate || preview.limitReached;
	const creatingPreview = preview.creating || !! previewsBeforeCreation;
	const showPreviewSkeleton =
		!! snapshot &&
		!! previewsBeforeCreation &&
		! preview.previews.some( ( item ) => ! previewsBeforeCreation.has( item.atomicSiteId ) );
	const hasChanges = !! selected && targets.hasChanges( selected );
	const upToDate = ! firstPublish && targets.selectedStatus?.data?.localChanged === false;
	const url = snapshot ? getSnapshotUrl( snapshot ) : remoteUrl;
	const hostname = url ? new URL( url ).hostname : undefined;
	const dashboardUrl = remote && descriptor?.dashboardUrl?.( remote );
	const adminUrl = remote && descriptor?.adminUrl?.( remote );
	const domainSettingsUrl = remote && descriptor?.domainSettingsUrl?.( remote );
	const hostingLinks = remote
		? descriptor?.describe( remote ).links.filter( ( link ) => link.url !== dashboardUrl ) ?? []
		: [];
	const publicDestination = snapshot ? selected!.provider : emptyDestination;
	const publicDescriptor = getProviderSites( publicDestination );
	const publicProviderLabel = getProvider( publicDestination ).label;
	const previewPublicSelected = !! snapshot && publicPreviewKey === selected?.key;
	const continueLabel = sprintf(
		/* translators: %s: hosting provider name. */
		__( 'Continue on %s' ),
		publicProviderLabel
	);
	const { copied, copy } = useCopyText( url ?? '' );
	const { copy: copyLinkFromMenu } = useCopyText( url ?? '', __( 'Link copied' ) );
	const publicDescription = checkoutUrl
		? __( 'Waiting for your new site' )
		: openingCheckout
		? openingDescription
		: publicDescriptor.publishing.description();
	const reopenCheckout = async ( checkoutUrl: string ) => {
		try {
			await connector.openExternalUrl( checkoutUrl );
		} catch {
			toast.error( __( 'Could not reopen the setup page. Please try again.' ) );
		}
	};
	const close = () => {
		preview.cancelOverwrite();
		setOpen( false );
		setPullRequest( undefined );
		setCheckout( undefined );
		setPublicPreviewKey( undefined );
		if ( selected ) setPublishProvider( undefined );
	};
	const select = ( target: PublishTarget ) => {
		setPullRequest( undefined );
		targets.select( target );
		setCheckout( undefined );
		setPublicPreviewKey( undefined );
		setFailure( undefined );
		setPublishProvider( undefined );
		if ( target.snapshot ) preview.selectPreview( getSnapshotHostname( target.snapshot ) );
	};
	const showPreviewLimit = () => {
		close();
		setPreviewLimitOpen( true );
	};
	const newPreview = ( liveSite?: string ) => {
		if ( preview.limitReached ) {
			showPreviewLimit();
			return;
		}
		if ( ! preview.canCreate || disabled || connectionUnavailable ) return;
		if ( liveSite === undefined && liveSites.length > 1 ) {
			setPreviewLiveSite( 'none' );
			return;
		}
		setPreviewLiveSite( undefined );
		setCheckout( undefined );
		setPublicPreviewKey( undefined );
		if ( targets.previewProvider ) rememberPublishProvider( targets.previewProvider );
		setPreviewsBeforeCreation( new Set( preview.previews.map( ( item ) => item.atomicSiteId ) ) );
		void preview
			.createPreview( async ( hostname ) => {
				targets.selectPreview( hostname );
				const snapshots = client.getQueryData< Snapshot[] >( SNAPSHOTS_QUERY_KEY );
				if (
					! snapshots?.some(
						( item ) => item.localSiteId === site.id && getSnapshotHostname( item ) === hostname
					)
				)
					await client.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			}, liveSite )
			.finally( () => setPreviewsBeforeCreation( undefined ) );
	};

	const startProvider = async ( provider: SitesProviderId ) => {
		const sites = getProviderSites( provider );
		if ( ! connectedProviders.includes( provider ) ) {
			close();
			openSettings( 'ai' );
			return;
		}
		rememberPublishProvider( provider );
		setPublishProvider( undefined );
		setFailure( undefined );
		setPreparing( sites.newSite );
		try {
			if ( sites.newSite === 'checkout' ) {
				const checkoutUrl = connector.getPublishCheckoutUrl( site );
				if ( ! checkoutUrl ) {
					setFailure( __( 'Could not open the setup page. Please try again.' ) );
					return;
				}
				const attempt: Checkout = {
					provider,
					primaryLabel: snapshot ? continueLabel : __( 'Create preview link' ),
				};
				setCheckout( attempt );
				clearPublishSetupError( site.id );
				void connector.trackEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE );
				void connector.watchForPublishedSite?.( site.id ).catch( () => {
					toast.error( __( 'Could not watch for your new site. Please try again.' ) );
				} );
				await connector.openExternalUrl( checkoutUrl );
				setCheckout( ( current ) =>
					current === attempt ? { ...attempt, url: checkoutUrl } : current
				);
			} else if ( sites.newSite === 'create' ) {
				const created = await connector.createRemoteSite( provider, site.id, site.name );
				await client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, site.id ) } );
				client.setQueryData(
					publishTargetQueryKey( site.id ),
					remotePublishTargetKey( provider, created.id )
				);
				try {
					await push.mutateAsync( { provider, siteId: site.id, remoteSiteId: created.id } );
				} catch {
					// The sync activity already reports transfer failures.
					return;
				}
				void client.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
			} else {
				setFailure( __( 'This destination cannot create a site from this panel yet.' ) );
			}
		} catch ( error ) {
			setFailure(
				error instanceof Error ? error.message : __( 'Could not publish. Please try again.' )
			);
		} finally {
			setPreparing( undefined );
		}
	};
	const chooseProvider = ( provider: SitesProviderId ) => {
		setCheckout( undefined );
		setFailure( undefined );
		setPublishProvider( provider );
	};
	const pullFromPreview = ( provider: SitesProviderId, snapshot: Snapshot ) => {
		close();
		setPullPreview( { provider, snapshot } );
	};
	const deletePreview = ( snapshot: Snapshot ) => {
		close();
		setPreviewAction( { kind: 'delete', snapshot, trigger: trigger.current } );
	};
	const learnMore = () =>
		void connector.openExternalUrl(
			snapshot ? 'https://wordpress.studio/docs/preview-sites/' : emptyDescriptor.intro.learnMoreUrl
		);
	const pullingSelected =
		!! remote &&
		liveTransfer &&
		activity.direction === 'pull' &&
		activity.provider === selected?.provider &&
		activity.remoteSiteId === remote.id;
	const selectedPending =
		targets.confirmingPublish ||
		( snapshot
			? preview.updating
			: !! remote &&
			  activity?.kind === 'pending' &&
			  activity.direction === 'push' &&
			  activity.provider === selected?.provider &&
			  activity.remoteSiteId === remote.id );
	const canConnectExistingSite = connectedProviders.includes(
		selected?.provider ?? publicDestination
	);
	const connectExistingSiteAction = canConnectExistingSite && (
		<Menu.Item
			disabled={ disabled || checkoutInProgress || connectionUnavailable }
			onClick={ () => setExistingProvider( selected?.provider ?? publicDestination ) }
		>
			<ConnectSiteIcon />
			{ __( 'Connect existing site' ) }
		</Menu.Item>
	);
	const showNewPreview = !! ( descriptor ?? emptyDescriptor ).previews;
	const renderPreviewActions = ( target: PublishTarget, inPanelMenu = false ) => {
		const item = target.snapshot!;
		const admin = getSnapshotAdminUrl( item );
		return (
			<>
				<Menu.Item
					disabled={ disabled }
					onClick={ () =>
						setPreviewAction( { kind: 'rename', snapshot: item, trigger: trigger.current } )
					}
				>
					<PencilIcon />
					{ __( 'Rename' ) }
				</Menu.Item>
				<Menu.Item disabled={ disabled } onClick={ () => void preview.updatePreview() }>
					<RefreshCwIcon />
					{ __( 'Update preview' ) }
				</Menu.Item>
				<Menu.Item disabled={ disabled } onClick={ () => pullFromPreview( target.provider, item ) }>
					<PullPreviewIcon />
					{ __( 'Pull from preview' ) }
				</Menu.Item>
				{ admin && (
					<Menu.Item onClick={ () => void connector.openExternalUrl( admin ) }>
						<WordPressIcon />
						{ __( 'WordPress admin' ) }
					</Menu.Item>
				) }
				{ inPanelMenu && canConnectExistingSite && (
					<>
						<Menu.Separator />
						{ connectExistingSiteAction }
					</>
				) }
				<Menu.Separator />
				<Menu.Item destructive disabled={ disabled } onClick={ () => deletePreview( item ) }>
					<TrashIcon />
					{ __( 'Delete preview' ) }
				</Menu.Item>
			</>
		);
	};
	const renderTargetActions = ( inPanelMenu = false ) =>
		selected &&
		( snapshot ? (
			renderPreviewActions( selected, inPanelMenu )
		) : (
			<>
				{ url && ! inPanelMenu && (
					<Menu.Item onClick={ copyLinkFromMenu }>
						<DuplicateIcon />
						{ __( 'Copy link' ) }
					</Menu.Item>
				) }
				{ ( adminUrl || dashboardUrl ) && (
					<Menu.Item onClick={ () => void connector.openExternalUrl( adminUrl || dashboardUrl! ) }>
						{ adminUrl ? <WordPressIcon /> : <ExternalLinkIcon /> }
						{ adminUrl
							? __( 'WordPress admin' )
							: sprintf(
									/* translators: %s: hosting provider name. */
									__( 'Open on %s' ),
									getProvider( selected.provider ).label
							  ) }
					</Menu.Item>
				) }
				{ hostingLinks.map( ( link ) => (
					<Menu.Item key={ link.url } onClick={ () => void connector.openExternalUrl( link.url ) }>
						<ExternalLinkIcon />
						{ link.title }
					</Menu.Item>
				) ) }
				{ descriptor?.pull && (
					<Menu.Item
						disabled={ disabled }
						onClick={ () =>
							setPullRequest( { provider: selected.provider, remoteSiteId: remote?.id } )
						}
					>
						<PullPreviewIcon />
						{ __( 'Pull from live site' ) }
					</Menu.Item>
				) }
				{ inPanelMenu && canConnectExistingSite && (
					<>
						<Menu.Separator />
						{ connectExistingSiteAction }
					</>
				) }
				<Menu.Separator />
				<Menu.Item
					destructive
					disabled={ disabled }
					onClick={ () => {
						close();
						disconnect.reset();
						setRemoveTarget( selected );
					} }
				>
					<DisconnectSiteIcon />
					{ __( 'Disconnect site' ) }
				</Menu.Item>
			</>
		) );

	return (
		<>
			<Popover.Root
				open={
					open &&
					accountsReady &&
					! needsAccount &&
					! showLivePull &&
					! existingProvider &&
					previewLiveSite === undefined &&
					! republishing &&
					! chooseFiles &&
					! previewAction
				}
				onOpenChange={ ( next, event ) => {
					if (
						! next &&
						( event.reason === 'outside-press' || event.reason === 'focus-out' ) &&
						[
							event.event.target,
							document.activeElement,
							( event.event as FocusEvent ).relatedTarget,
						].some(
							( element ) =>
								element instanceof Element && element.closest( '[data-slot="toast-viewport"]' )
						)
					) {
						event.cancel();
						return;
					}
					setOpen( next );
					if ( next ) {
						targets.refresh();
						if ( remote && descriptor?.visibility?.( remote ) ) void visibility.query.refetch();
					} else close();
				} }
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<Popover.Trigger
								render={
									<Button
										ref={ trigger }
										className={ styles.publishTrigger }
										variant={ variant }
										size="sm"
										aria-label={ remote ? __( 'Publish…' ) : __( 'Share…' ) }
										aria-description={
											setupError ??
											( activity?.kind === 'error'
												? activity.message
												: pending || selectedPending
												? activity?.direction === 'pull'
													? __( 'Pulling…' )
													: ( openingCheckout && openingDescription ) || __( 'Publishing…' )
												: undefined )
										}
									>
										{ pending || selectedPending ? (
											<Spinner data-icon="inline-start" />
										) : (
											<UploadIcon data-icon="inline-start" />
										) }
										<span>{ title }</span>
										{ hasChanges && ! selectedPending && (
											<span className={ styles.changeDot } data-pulse={ ! open || undefined }>
												<NotificationDot
													position="inline"
													tone="current"
													size="md"
													label={ __( 'Local changes' ) }
												/>
											</span>
										) }
									</Button>
								}
							/>
						}
					/>
					<TooltipContent>
						{ remote
							? sprintf(
									__( 'Publish changes to %s' ),
									new URL( remoteUrl ?? remote.url ).hostname
							  )
							: __( 'Share a preview or make it public' ) }
					</TooltipContent>
				</Tooltip>
				<span ref={ anchor } className={ styles.publishAnchor } aria-hidden="true" />
				<Popover.Popup
					anchor={ anchor }
					sideOffset={ 0 }
					align="end"
					backdrop={ ! liveTransfer }
					className={ styles.publishPopover }
					initialFocus={ false }
					finalFocus={ openingTargetDialog ? false : undefined }
					aria-label={ title }
				>
					<ShareView view={ preview.overwrite && ! remote ? 'overwrite' : 'main' }>
						{ preview.overwrite && ! remote ? (
							<>
								<p className={ styles.destinationLabel }>
									{ preview.overwrite.unknown
										? __( 'Replace preview contents?' )
										: __( 'Replace preview changes?' ) }
								</p>
								<Popover.Description>
									{ sprintf(
										preview.overwrite.unknown
											? __(
													'Changes on %s could not be checked. Updating will replace its files and database with your local copy.'
											  )
											: __( 'Changes on %s will be replaced with your local files and database.' ),
										getSnapshotHostname( preview.overwrite.snapshot )
									) }
								</Popover.Description>
								<div className={ styles.shareFooter }>
									<Button
										variant="outline"
										onClick={ () => {
											setCheckout( undefined );
											preview.cancelOverwrite();
										} }
									>
										{ __( 'Cancel' ) }
									</Button>
									<Button
										variant="accent"
										loading={ preview.updating }
										onClick={ () => void preview.confirmOverwrite() }
									>
										{ __( 'Replace preview' ) }
									</Button>
								</div>
							</>
						) : (
							<>
								<div className={ styles.destinationRow }>
									<Popover.Title className={ styles.destinationLabel }>{ title }</Popover.Title>
									{ ( showNewPreview || selected || canConnectExistingSite ) && (
										<Menu.Root>
											<Menu.Trigger
												render={
													<IconButton
														icon={ <EllipsisVerticalIcon /> }
														label={ __( 'More options' ) }
														variant="muted-ghost"
														size="icon-sm"
													/>
												}
											/>
											<Menu.Popup
												side="bottom"
												align="end"
												finalFocus={ openingTargetDialog ? false : undefined }
											>
												{ showNewPreview && (
													<>
														<Menu.Item
															disabled={ disabled || ! canRequestPreview || connectionUnavailable }
															onClick={ () => newPreview() }
														>
															<PlusIcon />
															{ __( 'New preview' ) }
														</Menu.Item>
														{ ( selected || canConnectExistingSite ) && <Menu.Separator /> }
													</>
												) }
												{ selected ? renderTargetActions( true ) : connectExistingSiteAction }
											</Menu.Popup>
										</Menu.Root>
									) }
								</div>
								<Popover.Description className={ styles.shareDescription }>
									{ checkoutUrl && checkoutProvider
										? sprintf(
												/* translators: %s: hosting provider name. */
												__( 'Finish setting up on %s.' ),
												checkoutProvider
										  )
										: remote
										? selectedPending
											? __( 'Your changes will be live in a moment.' )
											: firstPublish
											? descriptor?.publishing.firstPublishDescription?.( remote ) ??
											  __( 'Publish your WordPress when you’re ready.' )
											: upToDate
											? __( 'Your latest changes are live.' )
											: __( "You have changes that aren't live yet." )
										: snapshot
										? __( 'Anyone with the link can view this preview until it expires.' )
										: emptyDescription }
									{ ! checkoutUrl && remote && upToDate && ! selectedPending && (
										<>
											{ ' ' }
											<Button
												variant="inline-accent"
												size="inline"
												disabled={ disabled }
												onClick={ () => setRepublishing( true ) }
											>
												{ __( 'Publish again…' ) }
											</Button>
										</>
									) }
									{ ! checkoutUrl && ( ! selected || snapshot ) && (
										<>
											{ ' ' }
											<Button
												variant="inline-accent"
												size="inline"
												disabled={ openingCheckout }
												onClick={ learnMore }
											>
												{ __( 'Learn more' ) }
											</Button>
										</>
									) }
								</Popover.Description>
								{ selected &&
									hostname &&
									( ( remote ? targets.siteTargets.length : targets.previewTargets.length ) > 1 ||
										showPreviewSkeleton ) && (
										<>
											{ targets.targets.every( ( target ) => target.snapshot ) && (
												<h3 className={ styles.switcherHeading }>{ __( 'Previews' ) }</h3>
											) }
											<div className={ styles.settingsGroup }>
												{ showPreviewSkeleton ? (
													<Button
														variant="ghost"
														className={ styles.accessTrigger }
														disabled
														aria-label={ __( 'Choose destination' ) }
														aria-busy="true"
													>
														<Skeleton className={ styles.previewSkeletonIcon } />
														<span className={ styles.accessTriggerLabel }>
															<Skeleton className={ styles.previewSkeletonTitle } />
														</span>
														<Skeleton className={ styles.previewSkeletonIcon } />
													</Button>
												) : (
													<TargetSwitcher
														targets={ remote ? targets.siteTargets : targets.previewTargets }
														selectedKey={ selected.key }
														hostname={ hostname }
														locale={ locale }
														disabled={ disabled || openingCheckout }
														onSelect={ select }
														onNewPreview={ previewsCapability ? () => newPreview() : undefined }
														newPreviewDisabled={
															disabled || ! canRequestPreview || connectionUnavailable
														}
													/>
												) }
											</div>
										</>
									) }
								<div
									className={ styles.settingsGroup }
									data-opening-checkout={ openingCheckout || undefined }
								>
									{ ! selected && (
										<div
											className={ styles.destinationField }
											data-address-theme={ emptyDescriptor.publishing.addressTheme }
										>
											<ProviderPicker
												selectedProvider={ emptyDestination }
												providers={ connectedProviders }
												onConnectProviders={
													connectedProviders.length < targets.providers.length
														? () => {
																close();
																openSettings( 'ai' );
														  }
														: undefined
												}
												onSelect={ chooseProvider }
												disabled={ disabled }
											/>
										</div>
									) }
									{ showPreviewSkeleton && (
										<div
											className={ styles.addressRow }
											data-slot="preview-row-skeleton"
											aria-hidden="true"
										>
											<div className={ styles.destinationRowControl }>
												<Skeleton className={ styles.previewSkeletonIcon } />
												<div className={ styles.previewSkeletonLines }>
													<Skeleton className={ styles.previewSkeletonTitle } />
													<Skeleton className={ styles.previewSkeletonSubtitle } />
												</div>
												<Skeleton className={ styles.previewSkeletonIcon } />
											</div>
										</div>
									) }
									{ selected && url && hostname && ! showPreviewSkeleton && (
										<div
											className={ styles.addressRow }
											data-address-theme={
												remote ? descriptor?.publishing.addressTheme : undefined
											}
										>
											<Menu.ContextMenuRoot>
												<Menu.ContextMenuTrigger
													render={
														<DestinationRow
															ref={ urlRow }
															aria-haspopup="menu"
															icon={
																snapshot ? (
																	<LinkIcon />
																) : (
																	<ProviderLogo provider={ selected.provider } branded compact />
																)
															}
															label={ snapshot ? selected.label : hostname }
															description={ describePublishTarget(
																selected,
																locale,
																targets.targets
															) }
															trailing={ <ExternalLinkIcon /> }
															disabled={ openingCheckout }
															onClick={ () => void connector.openExternalUrl( url ) }
															aria-label={
																snapshot
																	? sprintf( __( 'Open preview: %s' ), selected.label )
																	: hostname
															}
														/>
													}
												/>
												<Menu.ContextPopup
													aria-label={ __( 'Destination actions' ) }
													finalFocus={ openingTargetDialog ? false : urlRow }
												>
													{ renderTargetActions() }
												</Menu.ContextPopup>
											</Menu.ContextMenuRoot>
										</div>
									) }
									{ remote &&
										descriptor?.visibility?.( remote ) &&
										descriptor.visibilityOptions && (
											<HostedAccessControl
												state={ visibility }
												getOptions={ descriptor.visibilityOptions }
												disabled={ disabled }
												fallback={ descriptor.initialVisibility?.( remote ) }
												managementLink={ descriptor.visibilitySettingsLink?.( remote ) }
											/>
										) }
									{ domainSettingsUrl && (
										<div>
											<DestinationRow
												icon={ <GlobeIcon /> }
												label={ __( 'Manage domain' ) }
												trailing={ <ExternalLinkIcon /> }
												onClick={ () => void connector.openExternalUrl( domainSettingsUrl ) }
											/>
										</div>
									) }
									{ snapshot && publicDescriptor.newSite === 'checkout' && (
										<PreviewAccessControl
											publicSelected={ previewPublicSelected }
											disabled={ disabled }
											providerLabel={ publicProviderLabel }
											onPublicSelectedChange={ ( next ) => {
												setPublicPreviewKey( next ? selected?.key : undefined );
												setCheckout( undefined );
												setFailure( undefined );
											} }
										/>
									) }
									{ ! selected && emptyDescriptor.previews && (
										<div>
											<DestinationRow
												icon={ <ProviderLogo provider={ publicDestination } branded compact /> }
												label={ __( 'Make it public' ) }
												description={ publicDescription }
												trailing={
													checkoutInProgress ? (
														<Spinner aria-hidden="true" />
													) : publicDescriptor.newSite === 'checkout' ? (
														<ExternalLinkIcon />
													) : (
														<ChevronRightIcon />
													)
												}
												data-checkout-progress={ checkoutInProgress || undefined }
												disabled={ disabled || checkoutInProgress || connectionUnavailable }
												focusableWhenDisabled={ checkoutInProgress }
												aria-busy={ openingCheckout || undefined }
												aria-label={ __( 'Make it public' ) }
												aria-description={ publicDescription }
												onClick={ () => void startProvider( publicDestination ) }
											/>
										</div>
									) }
									{ remote && descriptor?.selective && ! newDestination && (
										<PublishOptionsControl
											triggerRef={ publishOptionsTrigger }
											onChooseFiles={ () => setChooseFiles( true ) }
											provider={ selected!.provider }
											site={ site }
											remote={ remote }
											disabled={ disabled }
										/>
									) }
									{ ! selected && emptyDescriptor.content === 'static' && (
										<div>
											<DestinationRow
												informational
												icon={ <ProviderLogo provider={ emptyDestination } branded compact /> }
												label={
													emptyDescriptor.publishing.staticSiteLabel?.() ?? __( 'Make it public' )
												}
												description={ emptyDescriptor.publishing.description() }
											/>
										</div>
									) }
								</div>
								{ snapshot && preview.status.data?.previewChanged && (
									<div role="status" className={ styles.changeStatus }>
										<p>
											{ hasChanges
												? __( 'Local and preview changes' )
												: __( 'Preview has changes' ) }
										</p>
										<Button
											variant="inline-link"
											size="inline"
											disabled={ disabled }
											onClick={ () => pullFromPreview( selected!.provider, snapshot ) }
										>
											{ __( 'Pull from preview' ) }
										</Button>
									</div>
								) }
								{ emptyDescriptor.previews &&
									! snapshot &&
									! remote &&
									! preview.loading &&
									preview.unavailable &&
									! preview.signedOut && (
										<p className={ styles.changeStatus }>
											{ preview.unavailable }{ ' ' }
											{ preview.availabilityError && (
												<Button
													variant="inline-link"
													size="inline"
													onClick={ preview.retryAvailability }
												>
													{ __( 'Try again' ) }
												</Button>
											) }
										</p>
									) }
								{ setupError && (
									<p role="alert" className={ styles.changeStatus }>
										{ setupError }{ ' ' }
										<Button
											variant="inline-link"
											size="inline"
											onClick={ () => retryPublishSetup( site.id ) }
										>
											{ __( 'Try again' ) }
										</Button>
									</p>
								) }
								{ missingPullTarget && (
									<p role="alert" className={ styles.changeStatus }>
										{ __( 'The site requested for this pull is unavailable.' ) }
									</p>
								) }
								{ connectionUnavailable && (
									<Alert className={ styles.changeStatus }>
										<AlertTitle>
											{ sprintf(
												/* translators: %s: hosting provider name. */
												__( 'Couldn’t load your %s sites' ),
												getProvider( destinationProvider ).label
											) }
										</AlertTitle>
										<AlertDescription>
											{ __( 'Try again to see where this WordPress is already connected.' ) }
										</AlertDescription>
										<AlertActions>
											<Button
												variant="outline"
												size="sm"
												loading={ connection.refreshing }
												disabled={ connection.refreshing }
												onClick={ connection.retry }
											>
												{ connection.refreshing ? __( 'Checking…' ) : __( 'Try again' ) }
											</Button>
										</AlertActions>
									</Alert>
								) }
								{ failure && (
									<p role="alert" className={ styles.changeStatus }>
										{ failure }
									</p>
								) }
								<div
									className={ styles.shareFooter }
									role="group"
									aria-label={ remote ? __( 'Published site actions' ) : __( 'Preview actions' ) }
								>
									<div className={ styles.primaryActions }>
										{ checkoutUrl && checkoutProvider ? (
											<Button
												variant="outline"
												onClick={ () => void reopenCheckout( checkoutUrl ) }
											>
												{ sprintf(
													/* translators: %s: hosting provider name. */
													__( 'Reopen %s' ),
													checkoutProvider
												) }
												<ExternalLinkIcon />
											</Button>
										) : openingCheckout && activeCheckout ? (
											<Button
												variant="accent"
												loading={ !! snapshot }
												aria-description={ snapshot ? openingDescription : undefined }
												disabled
											>
												{ activeCheckout.primaryLabel }
											</Button>
										) : preparing === 'create' ? (
											<Button variant="accent" loading disabled>
												{ __( 'Publishing…' ) }
											</Button>
										) : creatingPreview && ! remote ? (
											<Button variant="accent" loading disabled>
												{ __( 'Creating preview link…' ) }
											</Button>
										) : ! selected && ! emptyDescriptor.previews ? (
											<Button
												variant="accent"
												disabled={ disabled || connectionUnavailable }
												onClick={ () => void startProvider( emptyDestination ) }
											>
												{ __( 'Publish' ) }
											</Button>
										) : previewPublicSelected ? (
											<Button
												variant="accent"
												disabled={ disabled || connectionUnavailable }
												onClick={ () => void startProvider( publicDestination ) }
											>
												{ continueLabel }
											</Button>
										) : snapshot ? (
											upToDate && ! selectedPending ? (
												<Button variant="outline" onClick={ copy }>
													{ copied ? __( 'Copied' ) : __( 'Copy link' ) }
												</Button>
											) : (
												<Button
													variant="accent"
													disabled={ ! preview.canUpdate || disabled }
													loading={ selectedPending }
													onClick={ () => void preview.updatePreview() }
												>
													{ selectedPending ? __( 'Updating preview…' ) : __( 'Update preview' ) }
												</Button>
											)
										) : remote ? (
											pullingSelected ? (
												<Button variant="accent" loading disabled>
													{ __( 'Pulling changes…' ) }
												</Button>
											) : upToDate && ! selectedPending ? (
												<Button variant="outline" onClick={ copy }>
													{ copied ? __( 'Copied' ) : __( 'Copy link' ) }
												</Button>
											) : disabled &&
											  ! selectedPending &&
											  ! preview.pending &&
											  ! creatingPreview ? (
												<p role="status">
													{ offline
														? __( "You're offline" )
														: __( 'Another operation is in progress.' ) }
												</p>
											) : (
												<LiveSiteAction
													site={ site }
													provider={ selected!.provider }
													remote={ remote }
													publishing={ selectedPending }
													disabled={ disabled }
													firstPublish={ firstPublish }
													forceEntireSite={ newDestination }
												/>
											)
										) : (
											<Button
												variant="accent"
												disabled={
													( ! canRequestPreview && ! preview.signedOut ) ||
													disabled ||
													connectionUnavailable
												}
												onClick={ () => {
													if ( preview.signedOut ) {
														close();
														openSettings( 'ai' );
													} else newPreview();
												} }
											>
												{ __( 'Create preview link' ) }
											</Button>
										) }
									</div>
								</div>
								{ remote && ( targets.selectedPreview || creatingPreview ) && (
									<PublishedPreviews
										targets={ targets }
										preview={ preview }
										creating={ creatingPreview }
										disabled={ disabled }
										locale={ locale }
										onNewPreview={ () => newPreview() }
										newPreviewDisabled={ disabled || ! canRequestPreview || connectionUnavailable }
										onSelect={ select }
										renderActions={ renderPreviewActions }
									/>
								) }
							</>
						) }
					</ShareView>
				</Popover.Popup>
			</Popover.Root>
			{ chooseFiles && selected && remote && (
				<PublishFilesDialog
					site={ site }
					provider={ selected.provider }
					remote={ remote }
					onClose={ () => {
						setChooseFiles( false );
						requestAnimationFrame( () => publishOptionsTrigger.current?.focus() );
					} }
					returnFocus={ publishOptionsTrigger }
				/>
			) }
			{ existingProvider && (
				<ExistingSiteDialog
					provider={ existingProvider }
					returnFocus={ trigger }
					siteId={ site.id }
					onClose={ () => setExistingProvider( undefined ) }
					onConnected={ ( id ) => {
						client.setQueryData(
							publishTargetQueryKey( site.id ),
							remotePublishTargetKey( existingProvider, id )
						);
						setCheckout( undefined );
						setExistingProvider( undefined );
					} }
				/>
			) }
			{ previewLiveSite !== undefined && (
				<Dialog open onOpenChange={ ( next ) => ! next && setPreviewLiveSite( undefined ) }>
					<DialogContent layout="compact" finalFocus={ trigger }>
						<DialogHeader>
							<DialogTitle>{ __( 'Live site' ) }</DialogTitle>
							<DialogDescription>
								{ __( 'Choose which live site this preview shows changes to.' ) }
							</DialogDescription>
						</DialogHeader>
						<Select
							value={ previewLiveSite }
							items={ [
								{ value: 'none', label: __( 'None' ) },
								...liveSites.map( ( live ) => ( {
									value: String( live.id ),
									label: live.name || live.url,
								} ) ),
							] }
							onValueChange={ ( value ) => setPreviewLiveSite( value ?? 'none' ) }
						>
							<SelectTrigger aria-label={ __( 'Live site' ) } fullWidth>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">{ __( 'None' ) }</SelectItem>
								{ liveSites.map( ( live ) => (
									<SelectItem key={ live.id } value={ String( live.id ) }>
										{ live.name || live.url }
									</SelectItem>
								) ) }
							</SelectContent>
						</Select>
						<DialogFooter>
							<Button
								variant="accent"
								disabled={ ! preview.canCreate }
								onClick={ () => newPreview( previewLiveSite ) }
							>
								{ __( 'Create preview link' ) }
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) }
			{ republishing && selected && remote && (
				<AlertDialog open onOpenChange={ ( next ) => ! next && setRepublishing( false ) }>
					<DialogContent layout="confirmation" finalFocus={ trigger }>
						<DialogHeader>
							<DialogTitle>{ __( 'Publish again?' ) }</DialogTitle>
							<DialogDescription>
								{ __(
									'The selected files, content, and settings on your live site will be overwritten.'
								) }
							</DialogDescription>
						</DialogHeader>
						<LiveSiteAction
							site={ site }
							provider={ selected.provider }
							remote={ remote }
							disabled={ disabled }
							onPublishStarted={ () => setRepublishing( false ) }
						/>
					</DialogContent>
				</AlertDialog>
			) }
			{ showLivePull && pullTarget?.remote && (
				<LiveSiteAction
					site={ site }
					provider={ pullTarget.provider }
					remote={ pullTarget.remote }
					direction="pull"
					disabled={ disabled }
					onBack={ () => {
						setPullRequest( undefined );
						trigger.current?.focus();
					} }
				/>
			) }
			<AlertDialog open={ previewLimitOpen } onOpenChange={ setPreviewLimitOpen }>
				<DialogContent layout="confirmation" finalFocus={ trigger }>
					<DialogHeader>
						<DialogTitle>{ __( 'Preview limit reached' ) }</DialogTitle>
						<DialogDescription>
							{ __( 'Delete a preview in Sharing settings to create another.' ) }
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={ () => setPreviewLimitOpen( false ) }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="accent"
							onClick={ () => {
								setPreviewLimitOpen( false );
								openSettings( 'sharing' );
							} }
						>
							{ __( 'Open settings' ) }
						</Button>
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
			<AccountPromptDialog
				open={ open && needsAccount }
				onOpenChange={ setOpen }
				finalFocus={ trigger }
				showStudioIcon={ false }
				title={ __( 'Share your WordPress' ) }
				description={ __(
					'Create an account or log in to share previews and keep your sites in sync.'
				) }
				source="previews_tab"
				analytics={ { placement: 'share', intent: 'share' } }
				scope={ site.id }
				onSkip={ () => {
					setOpen( false );
					openSettings( 'ai' );
				} }
				secondaryLabel={ __( 'Choose a different provider' ) }
			/>
			{ previewAction && (
				<PreviewManagementDialog
					action={ previewAction }
					site={ site }
					onClose={ () => {
						setPreviewAction( null );
						( previewAction.trigger?.isConnected
							? previewAction.trigger
							: trigger.current
						)?.focus();
					} }
				/>
			) }
			{ pullPreview && (
				<PullPreviewDialog
					site={ site }
					snapshot={ pullPreview.snapshot }
					provider={ pullPreview.provider }
					disabled={ disabled }
					onClose={ () => {
						setPullPreview( undefined );
						trigger.current?.focus();
					} }
				/>
			) }
			{ removeTarget?.remote && (
				<AlertDialog
					open
					onOpenChange={ ( next ) =>
						! next && ! disconnect.isPending && setRemoveTarget( undefined )
					}
				>
					<DialogContent layout="confirmation" initialFocus={ cancel } finalFocus={ trigger }>
						<DialogHeader>
							<DialogTitle>{ __( 'Disconnect site?' ) }</DialogTitle>
							<DialogDescription>
								{ sprintf(
									__(
										'Remove %s from WordPress Studio? The published site and your local WordPress won’t change.'
									),
									removeTarget.remote.url
								) }
							</DialogDescription>
						</DialogHeader>
						{ disconnect.error && <p role="alert">{ disconnect.error.message }</p> }
						<DialogFooter>
							<Button
								ref={ cancel }
								variant="outline"
								disabled={ disconnect.isPending }
								onClick={ () => setRemoveTarget( undefined ) }
							>
								{ __( 'Cancel' ) }
							</Button>
							<Button
								variant="destructive"
								loading={ disconnect.isPending }
								onClick={ () =>
									disconnect.mutate(
										{
											provider: removeTarget.provider,
											siteId: site.id,
											remoteSiteId: removeTarget.remote!.id,
										},
										{ onSuccess: () => setRemoveTarget( undefined ) }
									)
								}
							>
								{ __( 'Disconnect site' ) }
							</Button>
						</DialogFooter>
					</DialogContent>
				</AlertDialog>
			) }
		</>
	);
}
