import { getQualifyingLiveSites } from '@studio/common/lib/live-preview-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import {
	getProvider,
	getProviderSites,
	type SiteCreationVisibility,
	type SitesProviderId,
} from '@studio/providers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { CheckIcon, ClockIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
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
import { useSiteThumbnail } from '@/data/queries/use-site-thumbnail';
import { useSiteVisibility } from '@/data/queries/use-site-visibility';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { usePushSite } from '@/data/queries/use-sync-site';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { useOpenSettings } from '@/data/use-open-settings';
import { AccountPromptDialog } from '@/features/account';
import { PreviewManagementDialog, type PreviewManagementAction } from '@/features/sharing';
import { clearPublishSetupError, retryPublishSetup, usePublishSetupError } from '@/features/sync';
import { useOffline, useSubmitFeedback } from '@/lib/hooks';
import {
	ChevronRightIcon,
	CircleCheckIcon,
	EllipsisVerticalIcon,
	GlobeIcon,
	PlusIcon,
	PencilIcon,
	DuplicateIcon,
	ExternalLinkIcon,
	TrashIcon,
} from '@/lib/icons';
import {
	Alert,
	AlertTitle,
	AlertDescription,
	AlertActions,
	Button,
	IconButton,
	NotificationDot,
	Popover,
	PreviewFrame,
	PreviewImage,
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
import { DestinationIcon } from './destination-icon';
import { DestinationRow } from './destination-row';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { connectExistingSiteKey, ExistingSiteStep } from './existing-site-step';
import { GiftIcon } from './gift-icon';
import {
	HostedAccessControl,
	PreviewAccessControl,
	SiteCreationAccessControl,
} from './hosted-access-control';
import { LiveSiteAction } from './live-site-action';
import { isNewDestination } from './new-destination';
import { PreviewMenu } from './preview-menu';
import { PreviewOverwriteConfirmation } from './preview-overwrite-confirmation';
import { ProviderLogo } from './provider-logo';
import {
	ProviderPicker,
	rememberPublishProvider,
	orderedPublishProviders,
} from './provider-picker';
import { PullPreviewDialog } from './pull-preview-dialog';
import { PullPreviewIcon } from './pull-preview-icon';
import styles from './style.module.css';
import { describePublishTarget } from './target-description';
import { TargetSwitcher } from './target-switcher';
import { usePublishPreview } from './use-publish-preview';
import { usePublishTargets, type PublishTarget } from './use-publish-targets';

type PullRequest = { provider?: SitesProviderId; remoteSiteId?: string | number };

function PublishMenuItem( {
	icon,
	label,
	...props
}: Pick<
	ComponentProps< typeof DestinationRow >,
	'icon' | 'label' | 'disabled' | 'destructive'
> & { onClick: () => void } ) {
	return (
		<Menu.Item { ...props }>
			{ icon }
			{ label }
		</Menu.Item>
	);
}

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
	const anchor = useRef< HTMLSpanElement >( null );
	const [ open, setOpen ] = useState( false );
	const [ previewMenuOpen, setPreviewMenuOpen ] = useState( false );
	const [ shareRequested, setShareRequested ] = useState( false );
	const [ pullRequest, setPullRequest ] = useState< PullRequest >();
	const targets = usePublishTargets( site.id, open );
	const user = useAuthUser();
	const accounts = useAiSettings();
	const { data: preferences } = useUserPreferences();
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
			setShareRequested( false );
			setPreviewMenuOpen( false );
			setOpen( true );
		};
	} );
	useEffect( () => {
		const share = subscribeHeaderPanelRequest( site.id, 'share', () => setShareRequested( true ) );
		const publish = subscribeHeaderPanelRequest( site.id, 'publish', ( request ) =>
			requestHandler.current( request )
		);
		return () => {
			share();
			publish();
		};
	}, [ site.id ] );
	const stagedSite = useRef< {
		provider: SitesProviderId;
		siteId: string;
		remoteId: string | number;
		visibility?: SiteCreationVisibility;
	} >( undefined );
	const [ preparing, setPreparing ] = useState< 'checkout' | 'create' | 'confirm' >();
	const publishingNewSite = preparing === 'create' || preparing === 'confirm';
	const [ changingDestination, setChangingDestination ] = useState( false );
	const selected = publishingNewSite || changingDestination ? undefined : targets.selected;
	const hasLiveSite = targets.siteTargets.length > 0;
	const snapshot = selected?.snapshot;
	const remote = selected?.remote;
	const descriptor = selected ? getProviderSites( selected.provider ) : undefined;
	useEffect( () => {
		if ( ! shareRequested || ( ! remote && targets.loadingConnections ) ) return;
		setShareRequested( false );
		setPullRequest( undefined );
		const manageInSettings = !! remote && ! descriptor?.previews;
		setPreviewMenuOpen( ! manageInSettings );
		setOpen( ! manageInSettings );
		if ( manageInSettings ) openSettings( 'sharing' );
	}, [ shareRequested, remote, descriptor, targets.loadingConnections, openSettings ] );
	const newDestination = isNewDestination( remote );
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
	const title = __( 'Share' );
	const panelTitle = targets.targets.length === 0 ? __( 'Share this WordPress' ) : title;
	const creationErrorNotice = `publish-create-${ site.id }`;
	const { feedback: creationFeedback, shake: showCreationFeedback } = useSubmitFeedback();
	const activity = useSiteSyncActivity( site.id );
	const setupError = usePublishSetupError( site.id );
	const offline = useOffline();
	const busy = useIsSiteBusy( site );
	const push = usePushSite();
	const [ publishProvider, setPublishProvider ] = useState< SitesProviderId >();
	const defaultProvider = preferences?.defaultHostingProvider;
	const emptyDestination =
		( publishProvider && connectedProviders.includes( publishProvider )
			? publishProvider
			: undefined ) ??
		( defaultProvider && connectedProviders.includes( defaultProvider )
			? defaultProvider
			: undefined ) ??
		orderedPublishProviders( connectedProviders )[ 0 ] ??
		targets.providers[ 0 ];
	const emptyDescriptor = getProviderSites( emptyDestination );
	const destinationProvider = selected?.provider ?? emptyDestination;
	const connection = targets.connectionState( destinationProvider );
	const connectionUnavailable = ! selected && connection.unavailable;
	const showCreationAccess = ! selected && !! emptyDescriptor.visibilityAtCreation;
	const [ requestedVisibility, setRequestedVisibility ] = useState< SiteCreationVisibility >();
	const creationPolicy = useQuery( {
		queryKey: [ 'site-creation-visibility', emptyDestination ],
		queryFn: () => connector.getSiteCreationVisibility( emptyDestination ),
		enabled: open && showCreationAccess && connectedProviders.includes( emptyDestination ),
		retry: false,
		meta: { persist: false },
	} );
	const creationVisibility =
		creationPolicy.data === 'public' ? requestedVisibility ?? 'private' : creationPolicy.data;
	const previewConnection =
		targets.previewProvider && targets.connectionState( targets.previewProvider );
	const previewConnectionUnavailable = !! (
		previewConnection?.loading || previewConnection?.unavailable
	);
	const canOfferPreviews =
		!! targets.previewProvider && connectedProviders.includes( targets.previewProvider );
	const creationAccessUnavailable =
		showCreationAccess && ( creationPolicy.isError || ! creationVisibility );
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
	useEffect( () => {
		// Keep the setup in place until the connection and publish status have caught up.
		if ( preparing === 'confirm' && activity?.kind !== 'pending' && ! targets.confirmingPublish ) {
			setPreparing( undefined );
			setChangingDestination( false );
		}
	}, [ preparing, activity?.kind, targets.confirmingPublish ] );
	const [ publicPreviewKey, setPublicPreviewKey ] = useState< string >();
	const [ failure, setFailure ] = useState< string >();
	const [ previewLimitOpen, setPreviewLimitOpen ] = useState( false );
	const [ previewsBeforeCreation, setPreviewsBeforeCreation ] = useState< Set< number > >();
	const activePreviewCreation = useRef< Set< number > >( undefined );
	const [ previewAction, setPreviewAction ] = useState< PreviewManagementAction | null >( null );
	const [ removeTarget, setRemoveTarget ] = useState< PublishTarget >();
	const [ pullPreview, setPullPreview ] = useState< {
		snapshot: Snapshot;
		name: string;
		provider: SitesProviderId;
	} >();
	const [ choosingExistingSite, setChoosingExistingSite ] = useState( false );
	const connectSuggestion = useRef< HTMLButtonElement >( null );
	const previewSwitcher = useRef< HTMLButtonElement >( null );
	const publishMain = useRef< HTMLDivElement >( null );
	const backFromExistingSite = () => {
		publishMain.current?.focus();
		setChoosingExistingSite( false );
		requestAnimationFrame( () => ( connectSuggestion.current ?? publishMain.current )?.focus() );
	};
	const backFromPreviews = () => {
		publishMain.current?.focus();
		setPreviewMenuOpen( false );
		requestAnimationFrame( () => ( previewSwitcher.current ?? publishMain.current )?.focus() );
	};
	const [ previewLiveSite, setPreviewLiveSite ] = useState< string >();
	const [ publishConfirmation, setPublishConfirmation ] = useState< 'changes' | 'again' >();
	const openingTargetDialog = !! (
		showLivePull ||
		pullPreview ||
		previewAction ||
		removeTarget ||
		previewLiveSite !== undefined ||
		publishConfirmation
	);
	const locale = useUserLocale();
	const liveTransfer =
		activity?.kind === 'pending' &&
		( activity.direction === 'push' || activity.direction === 'pull' );
	const newPreviewSnapshot =
		previewsBeforeCreation &&
		preview.previews.find( ( item ) => ! previewsBeforeCreation.has( item.atomicSiteId ) );
	const waitingForNewPreview =
		!! previewsBeforeCreation && ! newPreviewSnapshot && ! preview.creationSettled;
	const creatingPreview = preview.creating || waitingForNewPreview;
	const pending =
		preview.pending ||
		creatingPreview ||
		!! preparing ||
		push.isPending ||
		activity?.kind === 'pending';
	const disabled = pending || offline || busy || ( ! selected && connection.loading );
	const canRequestPreview = preview.canCreate || preview.limitReached;
	const canShowPreviews =
		!! targets.previewProvider &&
		( !! targets.selectedPreview || ( !! selected && ( canOfferPreviews || creatingPreview ) ) );
	const previewOverwrite = remote ? preview.overwrite : undefined;
	const showPreviewSkeleton = !! snapshot && waitingForNewPreview;
	const selectCreatedPreview = targets.selectPreview;
	const resetPreviewCreation = preview.resetCreation;
	useEffect( () => {
		if ( ! preview.creationSettled ) return;
		// The CLI can save and announce the preview before the command returns to the renderer.
		resetPreviewCreation();
		if ( ! previewsBeforeCreation || activePreviewCreation.current !== previewsBeforeCreation )
			return;
		if ( newPreviewSnapshot ) {
			const hostname = getSnapshotHostname( newPreviewSnapshot );
			selectCreatedPreview( hostname );
			activePreviewCreation.current = undefined;
		}
		setPreviewsBeforeCreation( undefined );
	}, [
		newPreviewSnapshot,
		preview.creationSettled,
		previewsBeforeCreation,
		resetPreviewCreation,
		selectCreatedPreview,
	] );
	const hasChanges = !! selected && targets.hasChanges( selected );
	const upToDate = ! newDestination && targets.selectedStatus?.data?.localChanged === false;
	const url = snapshot ? getSnapshotUrl( snapshot ) : remoteUrl;
	const hostname = url ? new URL( url ).hostname : undefined;
	const dashboardUrl = remote && descriptor?.dashboardUrl?.( remote );
	const adminUrl = remote && descriptor?.adminUrl?.( remote );
	const domainSettingsUrl =
		remote &&
		( descriptor?.domainSettingsUrl?.( remote ) ??
			( selected?.provider === 'wpcom' && dashboardUrl
				? `${ dashboardUrl }/domains`
				: undefined ) );
	const spacefastAddDomainUrl =
		selected?.provider === 'spacefast' && domainSettingsUrl
			? `${ domainSettingsUrl }/add`
			: undefined;
	const hostingLinks = remote
		? descriptor
				?.describe( remote )
				.links.filter( ( link ) => link.url !== dashboardUrl && link.url !== domainSettingsUrl ) ??
		  []
		: [];
	const publicDestination = snapshot ? selected!.provider : emptyDestination;
	const publicDescriptor = getProviderSites( publicDestination );
	const publicProviderLabel = getProvider( publicDestination ).label;
	const showPreviewAccess =
		! remote && !! publicDescriptor.previews && publicDescriptor.newSite === 'checkout';
	const previewAccessKey = selected?.key ?? emptyDestination;
	const previewPublicSelected = showPreviewAccess && publicPreviewKey === previewAccessKey;
	const showDomainButton =
		!! snapshot || ( ! selected && showPreviewAccess && ! publishingNewSite );
	const openingCheckout = ! remote && preparing === 'checkout';
	const openingDescription = sprintf(
		/* translators: %s: hosting provider name. */
		__( 'Opening %s' ),
		publicProviderLabel
	);
	const continueLabel = sprintf(
		/* translators: %s: hosting provider name. */
		__( 'Continue on %s' ),
		publicProviderLabel
	);
	const publishedDestination =
		!! remote &&
		! newDestination &&
		( !! remote.lastPushTimestamp ||
			!! descriptor?.isLaunched?.( remote ) ||
			visibility.query.data?.launchStatus === 'launched' );
	const { copy: copyLink, copied: linkCopied } = useCopyText( url ?? '', __( 'Link copied' ) );
	const close = () => {
		setChangingDestination( false );
		setChoosingExistingSite( false );
		setPreviewMenuOpen( false );
		preview.cancelOverwrite();
		setOpen( false );
		setPullRequest( undefined );
		setPublicPreviewKey( undefined );
		if ( ! publishingNewSite ) {
			setRequestedVisibility( undefined );
			if ( selected ) setPublishProvider( undefined );
		}
	};
	const select = ( target: PublishTarget ) => {
		activePreviewCreation.current = undefined;
		setPullRequest( undefined );
		targets.select( target );
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
		if ( ! preview.canCreate || disabled || previewConnectionUnavailable ) return;
		if ( liveSite === undefined && liveSites.length > 1 ) {
			setPreviewMenuOpen( false );
			setPreviewLiveSite( 'none' );
			return;
		}
		setPreviewLiveSite( undefined );
		setPublicPreviewKey( undefined );
		if ( targets.previewProvider ) rememberPublishProvider( targets.previewProvider );
		const beforeCreation = new Set( preview.previews.map( ( item ) => item.atomicSiteId ) );
		activePreviewCreation.current = beforeCreation;
		setPreviewsBeforeCreation( beforeCreation );
		void preview
			.createPreview( liveSite )
			.then( async ( hostname ) => {
				if ( activePreviewCreation.current !== beforeCreation ) return;
				if ( ! hostname ) return;
				targets.selectPreview( hostname );
				const snapshots = client.getQueryData< Snapshot[] >( SNAPSHOTS_QUERY_KEY );
				if (
					! snapshots?.some(
						( item ) => item.localSiteId === site.id && getSnapshotHostname( item ) === hostname
					)
				) {
					await client.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
				}
			} )
			.finally( () => {
				if ( activePreviewCreation.current !== beforeCreation ) return;
				activePreviewCreation.current = undefined;
				setPreviewsBeforeCreation( undefined );
			} );
	};

	const startProvider = async (
		provider: SitesProviderId,
		{
			visibility,
			entryPoint = 'publish',
		}: {
			visibility?: SiteCreationVisibility;
			entryPoint?: 'publish' | 'get_free_domain';
		} = {}
	) => {
		const sites = getProviderSites( provider );
		if ( ! connectedProviders.includes( provider ) ) {
			close();
			openSettings( 'providers' );
			return;
		}
		rememberPublishProvider( provider );
		setPublishProvider( provider );
		setFailure( undefined );
		setPreparing( sites.newSite );
		let createdSite = false;
		try {
			if ( sites.newSite === 'checkout' ) {
				const checkoutUrl = connector.getPublishCheckoutUrl( site );
				if ( ! checkoutUrl ) {
					setFailure( __( 'Could not open the setup page. Please try again.' ) );
					return;
				}
				clearPublishSetupError( site.id );
				void connector.trackEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE, { entry_point: entryPoint } );
				void connector.watchForPublishedSite?.( site.id ).catch( () => {
					toast.error( __( 'Could not watch for your new site. Please try again.' ) );
				} );
				await connector.openExternalUrl( checkoutUrl );
				setChangingDestination( false );
			} else if ( sites.newSite === 'create' ) {
				const staged = stagedSite.current;
				const remoteId =
					staged?.siteId === site.id &&
					staged.provider === provider &&
					staged.visibility === visibility
						? staged.remoteId
						: (
								await connector.createRemoteSite( provider, site.id, site.name, visibility, false )
						  ).id;
				stagedSite.current = { provider, siteId: site.id, remoteId, visibility };
				dismissToast( creationErrorNotice );
				try {
					await push.mutateAsync( { provider, siteId: site.id, remoteSiteId: remoteId } );
				} catch {
					// The sync activity already reports transfer failures.
					return;
				}
				stagedSite.current = undefined;
				await Promise.all(
					targets.providers.map( ( id ) =>
						client.invalidateQueries( { queryKey: remoteSitesQueryKey( id, site.id ) } )
					)
				);
				client.setQueryData(
					publishTargetQueryKey( site.id ),
					remotePublishTargetKey( provider, remoteId )
				);
				createdSite = true;
				void client.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
			} else {
				setFailure( __( 'This destination cannot create a site from this panel yet.' ) );
			}
		} catch ( error ) {
			if ( sites.visibilityAtCreation ) void creationPolicy.refetch();
			const message =
				error instanceof Error ? error.message : __( 'Could not publish. Please try again.' );
			if ( sites.newSite === 'create' ) {
				showCreationFeedback();
				toast.error( __( 'Publishing didn’t finish' ), {
					id: creationErrorNotice,
					description: message,
					durationMs: 0,
				} );
			} else {
				setFailure( message );
			}
		} finally {
			setPreparing( createdSite ? 'confirm' : undefined );
		}
	};
	const chooseProvider = ( provider: SitesProviderId ) => {
		if ( snapshot ) targets.select( null );
		setPublicPreviewKey( undefined );
		setRequestedVisibility( undefined );
		setFailure( undefined );
		setPublishProvider( provider );
	};
	const deletePreview = ( snapshot: Snapshot ) => {
		close();
		setPreviewAction( { kind: 'delete', snapshot, trigger: trigger.current } );
	};

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
	const canConnectExistingSite =
		( ! hasLiveSite || changingDestination ) && connectedProviders.length > 0;
	const { data: thumbnail } = useSiteThumbnail( site.id, {
		enabled: open,
	} );

	const renderPreviewActions = ( target: PublishTarget ) => {
		const item = target.snapshot!;
		return (
			<>
				<PublishMenuItem
					icon={ <PencilIcon /> }
					label={ __( 'Rename' ) }
					disabled={ disabled }
					onClick={ () => {
						setPreviewMenuOpen( false );
						setPreviewAction( { kind: 'rename', snapshot: item, trigger: trigger.current } );
					} }
				/>
				<PublishMenuItem
					icon={ <PullPreviewIcon /> }
					label={ __( 'Update from preview…' ) }
					disabled={ disabled }
					onClick={ () => {
						close();
						setPullPreview( { provider: target.provider, name: target.label, snapshot: item } );
					} }
				/>
				<Menu.Separator />
				<PublishMenuItem
					icon={ <TrashIcon /> }
					label={ __( 'Delete preview' ) }
					destructive
					disabled={ disabled }
					onClick={ () => deletePreview( item ) }
				/>
			</>
		);
	};
	const renderLiveSiteActions = () => {
		if ( ! selected || ! remote ) return null;
		return (
			<>
				{ ! adminUrl && dashboardUrl && (
					<PublishMenuItem
						icon={ <ExternalLinkIcon /> }
						label={ sprintf(
							/* translators: %s: hosting provider name. */
							__( 'Open on %s' ),
							getProvider( selected.provider ).label
						) }
						onClick={ () => void connector.openExternalUrl( dashboardUrl ) }
					/>
				) }
				{ descriptor?.pull && (
					<PublishMenuItem
						icon={ <PullPreviewIcon /> }
						label={ __( 'Update from live site…' ) }
						disabled={ disabled }
						onClick={ () =>
							setPullRequest( { provider: selected.provider, remoteSiteId: remote.id } )
						}
					/>
				) }
				{ hostingLinks.map( ( link ) => (
					<PublishMenuItem
						key={ link.url }
						icon={ <ExternalLinkIcon /> }
						label={ link.title }
						onClick={ () => void connector.openExternalUrl( link.url ) }
					/>
				) ) }
				{ connectedProviders.length > 0 && (
					<PublishMenuItem
						icon={ <DestinationIcon /> }
						label={ __( 'Change destination…' ) }
						disabled={ disabled }
						onClick={ () => {
							chooseProvider( selected.provider );
							setChangingDestination( true );
						} }
					/>
				) }
				<Menu.Separator />
				<PublishMenuItem
					icon={ <DisconnectSiteIcon /> }
					label={ __( 'Disconnect site…' ) }
					destructive
					disabled={ disabled }
					onClick={ () => {
						close();
						setRemoveTarget( selected );
					} }
				/>
			</>
		);
	};

	const showCreatePreview = canShowPreviews && ( !! snapshot || publishedDestination );
	const newPreviewDisabled = disabled || ! canRequestPreview || previewConnectionUnavailable;
	const localChanged = targets.selectedStatus?.data?.localChanged;
	const activityLabel =
		selected && describePublishTarget( selected, locale, targets.targets, false );
	const showChanges =
		! newDestination &&
		! pending &&
		! selectedPending &&
		localChanged != null &&
		( ! snapshot || preview.status.data?.previewChanged === false );
	const changesLabel =
		! snapshot && showChanges
			? localChanged
				? __( 'Local changes' )
				: __( 'No changes' )
			: undefined;
	const ChangesIcon = localChanged ? PencilIcon : CircleCheckIcon;
	const destinationStatus = ( activityLabel || changesLabel ) && (
		<div className={ remote ? styles.publishedStatusRow : styles.summaryLine }>
			{ activityLabel ? <ClockIcon aria-hidden="true" /> : <ChangesIcon aria-hidden="true" /> }
			<span>
				{ activityLabel && <span>{ activityLabel }</span> }
				{ activityLabel && changesLabel && ' · ' }
				{ changesLabel && <span>{ changesLabel }</span> }
			</span>
		</div>
	);
	const copyLinkButton = url && ( publishedDestination || ( snapshot && ! creatingPreview ) ) && (
		<IconButton
			variant="ghost"
			size="icon-sm"
			icon={ linkCopied ? <CheckIcon /> : <DuplicateIcon /> }
			label={ linkCopied ? __( 'Copied' ) : __( 'Copy link' ) }
			onClick={ copyLink }
		/>
	);
	const targetActionsMenu = (
		target: PublishTarget,
		label: string = target.remote ? __( 'Site actions' ) : __( 'Preview actions' )
	) => (
		<Menu.Root>
			<Menu.Trigger
				render={
					<IconButton
						variant="ghost"
						size="icon-sm"
						icon={ <EllipsisVerticalIcon /> }
						label={ label }
						disabled={ disabled || openingCheckout }
					/>
				}
			/>
			<Menu.Popup
				align="end"
				aria-label={ target.remote ? label : target.label }
				finalFocus={ openingTargetDialog ? false : undefined }
			>
				{ target.remote ? renderLiveSiteActions() : renderPreviewActions( target ) }
			</Menu.Popup>
		</Menu.Root>
	);
	const addressActions = url && hostname && (
		<div className={ styles.siteAddressActions }>
			{ copyLinkButton }
			{ selected && targetActionsMenu( selected ) }
		</div>
	);
	const addressLink = url && hostname && (
		<a
			className={ styles.siteAddressLink }
			href={ url }
			target="_blank"
			rel="noopener noreferrer"
			title={ hostname }
			aria-label={ sprintf(
				/* translators: %s: the preview or site hostname. */
				snapshot ? __( 'Open preview: %s' ) : __( 'Open %s' ),
				hostname
			) }
			aria-disabled={ openingCheckout || undefined }
			tabIndex={ openingCheckout ? -1 : undefined }
			onClick={ ( event ) => {
				event.preventDefault();
				if ( ! openingCheckout ) void connector.openExternalUrl( url );
			} }
		>
			{ hostname }
		</a>
	);
	const headerProvider = selected?.provider ?? emptyDestination;
	const providerName = getProvider( headerProvider ).label;
	const siteVisibility = visibility.query.data?.visibility;
	const previewExpiryDate =
		snapshot &&
		new Date( getSnapshotExpiry( snapshot ) ).toLocaleDateString( locale, {
			month: 'short',
			day: 'numeric',
		} );
	const headerStatus =
		creatingPreview && ! remote
			? __( 'Creating preview link…' )
			: previewExpiryDate
			? createInterpolateElement(
					/* translators: <date> is replaced with the date the preview expires. */
					__( 'Expires on <date />' ),
					{
						date: (
							<Tooltip>
								<TooltipTrigger
									render={ <span className={ styles.previewExpiryDate } tabIndex={ 0 } /> }
								>
									{ previewExpiryDate }
								</TooltipTrigger>
								<TooltipContent>
									{ __(
										'The preview link stops working after this date. Your local WordPress stays available in Studio.'
									) }
								</TooltipContent>
							</Tooltip>
						),
					}
			  )
			: remote
			? sprintf(
					/* translators: %s: the name of the hosting provider. */
					! publishedDestination
						? __( 'Connected to %s' )
						: siteVisibility === 'public'
						? __( 'Live on %s' )
						: siteVisibility === 'coming-soon'
						? __( 'Coming soon on %s' )
						: siteVisibility === 'private'
						? __( 'Restricted on %s' )
						: __( 'Published on %s' ),
					providerName
			  )
			: __( 'Not published yet' );
	const targetSwitcher = selected &&
		hostname &&
		( snapshot
			? targets.siteTargets.length > 0
			: targets.siteTargets.length > 1 || !! targets.selectedPreview ) && (
			<TargetSwitcher
				targets={
					targets.selectedPreview
						? [ ...targets.siteTargets, snapshot ? selected : targets.selectedPreview ]
						: targets.siteTargets
				}
				selectedKey={ selected.key }
				hostname={ hostname }
				locale={ locale }
				disabled={ disabled || openingCheckout }
				onSelect={ select }
			/>
		);
	const previewMenu = canShowPreviews && (
		<PreviewMenu
			previews={ targets.previewTargets }
			selectedPreview={ snapshot ? selected : undefined }
			showSinglePreview={ ! selected }
			onSelectPreview={ select }
			switchingDisabled={ disabled }
			locale={ locale }
			open={ previewMenuOpen }
			onOpen={ () => setPreviewMenuOpen( true ) }
			onBack={ backFromPreviews }
			onClose={ () => {
				close();
				trigger.current?.focus();
			} }
			triggerRef={ previewSwitcher }
			onNewPreview={ () => newPreview() }
			newPreviewDisabled={ newPreviewDisabled }
			creating={ creatingPreview }
			unavailable={ preview.unavailable }
			retryAvailability={ preview.availabilityError ? preview.retryAvailability : undefined }
			renderActions={ ( target ) =>
				targetActionsMenu(
					target,
					sprintf(
						/* translators: %s: the preview name. */
						__( 'Preview actions for %s' ),
						target.label
					)
				)
			}
		/>
	);
	const publishContent = (
		<>
			<div className={ styles.siteHeader }>
				{ thumbnail ? (
					<div className={ styles.siteHeaderArtwork }>
						<PreviewFrame>
							<PreviewImage src={ thumbnail } alt="" />
						</PreviewFrame>
						<span className={ styles.siteHeaderProviderBadge }>
							<ProviderLogo provider={ headerProvider } site={ remote } compact />
						</span>
					</div>
				) : (
					<ProviderLogo provider={ headerProvider } site={ remote } />
				) }
				<h2>{ site.name }</h2>
				<div className={ styles.siteHeaderStatus }>
					<p>
						<span className={ creatingPreview && ! remote ? 'studio-shimmer' : undefined }>
							{ headerStatus }
						</span>
						{ snapshot && showChanges && localChanged && (
							<>
								{ ' · ' }
								<span>{ __( 'Has changes' ) }</span>
							</>
						) }
					</p>
				</div>
			</div>
			<h3 className={ styles.publishSectionLabel }>{ __( 'Details' ) }</h3>
			{ changingDestination && (
				<p>
					{ __(
						'Your current site stays online. Studio will disconnect it when the new destination is ready.'
					) }
				</p>
			) }
			<div className={ styles.summaryRows }>
				{ targetSwitcher }
				{ ( ! hasLiveSite || publishingNewSite || changingDestination ) && (
					<ProviderPicker
						selectedProvider={ selected?.provider ?? emptyDestination }
						providers={ connectedProviders }
						onConnectProviders={
							connectedProviders.length < targets.providers.length
								? () => {
										close();
										openSettings( 'providers' );
								  }
								: undefined
						}
						onSelect={ chooseProvider }
						disabled={ disabled }
					/>
				) }
				{ showPreviewSkeleton && (
					<div
						className={ styles.siteAddressRow }
						data-slot="preview-row-skeleton"
						aria-hidden="true"
					>
						<Skeleton className={ styles.previewSkeletonIcon } />
						<span className={ styles.previewHostname }>
							<Skeleton className={ styles.previewSkeletonTitle } />
						</span>
						<div className={ styles.siteAddressActions }>
							<span className={ styles.previewSkeletonAction }>
								<Skeleton className={ styles.previewSkeletonIcon } />
							</span>
							<span className={ styles.previewSkeletonAction }>
								<Skeleton className={ styles.previewSkeletonIcon } />
							</span>
						</div>
					</div>
				) }
				{ selected && snapshot && ! showPreviewSkeleton && (
					<div role="group" aria-label={ sprintf( __( 'Preview: %s' ), selected.label ) }>
						<div className={ styles.siteAddressRow }>
							<span className={ styles.destinationRowIcon }>
								<ProviderLogo provider={ selected.provider } branded compact />
							</span>
							{ addressLink }
							{ addressActions }
						</div>
						{ destinationStatus }
					</div>
				) }
				{ selected && remote && url && hostname && ! showPreviewSkeleton && (
					<>
						<div className={ styles.siteAddressRow }>
							<span className={ styles.destinationRowIcon }>
								<ProviderLogo provider={ selected.provider } site={ remote } branded compact />
							</span>
							{ addressLink }
							{ addressActions }
						</div>
						{ destinationStatus }
					</>
				) }
				{ remote && descriptor?.visibility?.( remote ) && descriptor.visibilityOptions && (
					<HostedAccessControl
						state={ visibility }
						getOptions={ descriptor.visibilityOptions }
						disabled={ disabled }
						fallback={ descriptor.initialVisibility?.( remote ) }
						managementLink={ descriptor.visibilitySettingsLink?.( remote ) }
					/>
				) }
				{ showPreviewAccess && (
					<PreviewAccessControl
						publicSelected={ previewPublicSelected }
						disabled={ disabled }
						onPublicSelectedChange={ ( next ) => {
							setPublicPreviewKey( next ? previewAccessKey : undefined );
							setFailure( undefined );
						} }
					/>
				) }
				{ showCreationAccess && emptyDescriptor.visibilityOptions && (
					<SiteCreationAccessControl
						value={ creationVisibility }
						policy={ creationPolicy.data }
						loading={ creationPolicy.isPending }
						disabled={ disabled || creationAccessUnavailable }
						getOptions={ emptyDescriptor.visibilityOptions }
						onChange={ setRequestedVisibility }
					/>
				) }
				{ previewMenu }
			</div>
			{ snapshot && preview.status.data?.previewChanged && (
				<p role="status" className={ styles.changeStatus }>
					{ hasChanges ? __( 'Local and preview changes' ) : __( 'Preview has changes' ) }
				</p>
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
							<Button variant="inline-link" size="inline" onClick={ preview.retryAvailability }>
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
							loading={ connection.refreshing }
							disabled={ connection.refreshing }
							onClick={ connection.retry }
						>
							{ connection.refreshing ? __( 'Checking…' ) : __( 'Try again' ) }
						</Button>
					</AlertActions>
				</Alert>
			) }
			{ showCreationAccess && creationPolicy.isError && (
				<p role="alert" className={ styles.changeStatus }>
					{ __( 'Couldn’t check who can view new sites for this team.' ) }{ ' ' }
					<Button
						variant="inline-accent"
						size="inline"
						disabled={ creationPolicy.isFetching }
						onClick={ () => void creationPolicy.refetch() }
					>
						{ __( 'Try again' ) }
					</Button>
				</p>
			) }
			{ failure && (
				<p role="alert" className={ styles.changeStatus }>
					{ failure }
				</p>
			) }
			{ ( showCreatePreview ||
				spacefastAddDomainUrl ||
				showDomainButton ||
				canConnectExistingSite ) && (
				<section className={ styles.publishSection } aria-label={ __( 'Suggested' ) }>
					<h3 className={ styles.publishSectionLabel }>{ __( 'Suggested' ) }</h3>
					<div className={ styles.summaryRows }>
						{ showDomainButton && (
							<DestinationRow
								icon={ <GiftIcon /> }
								label={ __( 'Get a free domain' ) }
								trailing={ <ExternalLinkIcon /> }
								disabled={ disabled || connectionUnavailable }
								onClick={ () =>
									void startProvider( publicDestination, { entryPoint: 'get_free_domain' } )
								}
							/>
						) }
						{ showCreatePreview && (
							<DestinationRow
								icon={ <PlusIcon /> }
								label={ __( 'Create new preview' ) }
								disabled={ newPreviewDisabled }
								onClick={ () => newPreview() }
							/>
						) }
						{ spacefastAddDomainUrl && (
							<DestinationRow
								icon={ <GlobeIcon /> }
								label={ __( 'Add a domain' ) }
								trailing={ <ExternalLinkIcon /> }
								onClick={ () => void connector.openExternalUrl( spacefastAddDomainUrl ) }
							/>
						) }

						{ canConnectExistingSite && (
							<DestinationRow
								icon={ <ConnectSiteIcon /> }
								ref={ connectSuggestion }
								label={ __( 'Connect to an existing site' ) }
								trailing={ <ChevronRightIcon data-navigation-chevron /> }
								disabled={ disabled }
								onClick={ () => setChoosingExistingSite( true ) }
							/>
						) }
					</div>
				</section>
			) }
			<div
				className={ styles.shareFooter }
				role="group"
				aria-label={ remote ? __( 'Published site actions' ) : __( 'Preview actions' ) }
			>
				<div className={ styles.footerActions }>
					{ changingDestination && (
						<Button
							variant="outline"
							disabled={ disabled }
							onClick={ () => setChangingDestination( false ) }
						>
							{ __( 'Back' ) }
						</Button>
					) }
					{ publishingNewSite ? (
						<Button variant="accent" loading disabled>
							{ __( 'Publishing…' ) }
						</Button>
					) : creatingPreview && ! remote ? (
						<Button variant="accent" loading disabled>
							{ __( 'Creating preview' ) }
						</Button>
					) : ! selected && ! emptyDescriptor.previews ? (
						<Button
							variant={ creationFeedback ? 'destructive' : 'accent' }
							disabled={ disabled || connectionUnavailable || creationAccessUnavailable }
							onClick={ () =>
								void startProvider( emptyDestination, { visibility: creationVisibility } )
							}
						>
							{ __( 'Publish' ) }
						</Button>
					) : previewPublicSelected || changingDestination ? (
						<Button
							variant="accent"
							disabled={ disabled || connectionUnavailable }
							loading={ openingCheckout }
							aria-description={ openingCheckout ? openingDescription : undefined }
							onClick={ () => void startProvider( publicDestination ) }
						>
							{ continueLabel }
							<ExternalLinkIcon data-icon="inline-end" />
						</Button>
					) : snapshot ? (
						<Button
							variant="accent"
							disabled={ ! preview.canUpdate || disabled }
							loading={ selectedPending }
							onClick={ () => void preview.updatePreview() }
						>
							{ selectedPending ? __( 'Updating…' ) : __( 'Update' ) }
						</Button>
					) : remote ? (
						pullingSelected ? (
							<Button variant="accent" loading disabled>
								{ __( 'Pulling changes…' ) }
							</Button>
						) : disabled && ! selectedPending && ! preview.pending && ! creatingPreview ? (
							<p role="status">
								{ offline ? __( "You're offline" ) : __( 'Another operation is in progress.' ) }
							</p>
						) : (
							<LiveSiteAction
								site={ site }
								provider={ selected!.provider }
								remote={ remote }
								publishing={ selectedPending }
								disabled={ disabled }
								forceEntireSite={ newDestination }
								onConfirmPublish={
									newDestination
										? undefined
										: () => setPublishConfirmation( upToDate ? 'again' : 'changes' )
								}
							/>
						)
					) : (
						<Button
							variant="accent"
							disabled={
								( ! canRequestPreview && ! preview.signedOut ) || disabled || connectionUnavailable
							}
							onClick={ () => {
								if ( preview.signedOut ) {
									close();
									openSettings( 'providers' );
								} else newPreview();
							} }
						>
							{ __( 'Create preview' ) }
						</Button>
					) }
				</div>
			</div>
		</>
	);

	return (
		<>
			<Popover.Root
				open={
					open &&
					accountsReady &&
					! needsAccount &&
					! showLivePull &&
					previewLiveSite === undefined &&
					! publishConfirmation &&
					! previewAction &&
					! previewOverwrite
				}
				onOpenChange={ ( next, event ) => {
					if ( ! next && previewMenuOpen && event.reason === 'escape-key' ) {
						event.cancel();
						backFromPreviews();
						return;
					}
					if ( ! next && choosingExistingSite ) {
						if ( client.isMutating( { mutationKey: connectExistingSiteKey( site.id ) } ) ) {
							event.cancel();
							return;
						}
						if ( event.reason === 'escape-key' ) {
							event.cancel();
							backFromExistingSite();
							return;
						}
					}
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
						setPreviewMenuOpen( false );
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
										aria-label={ __( 'Share…' ) }
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
										{ ( ! publishingNewSite || ! open ) && ( pending || selectedPending ) && (
											<Spinner data-icon="inline-start" />
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
				<span
					ref={ anchor }
					className={ styles.publishAnchor }
					data-site-stopped={ ! site.running || undefined }
					aria-hidden="true"
				/>
				<Popover.Popup
					anchor={ anchor }
					sideOffset={ 0 }
					align="end"
					instant={ openingTargetDialog || !! previewOverwrite }
					backdrop={ ! liveTransfer }
					className={ styles.publishPopover }
					initialFocus={ false }
					finalFocus={ openingTargetDialog || previewOverwrite ? false : undefined }
					aria-label={ panelTitle }
				>
					<div
						ref={ publishMain }
						tabIndex={ -1 }
						className={
							! choosingExistingSite && ! previewMenuOpen && ! ( preview.overwrite && ! remote )
								? styles.publishContent
								: undefined
						}
					>
						{ choosingExistingSite ? (
							<ExistingSiteStep
								providers={ connectedProviders }
								siteId={ site.id }
								onBack={ backFromExistingSite }
								onClose={ () => {
									close();
									trigger.current?.focus();
								} }
								onConnected={ ( provider, id ) => {
									client.setQueryData(
										publishTargetQueryKey( site.id ),
										remotePublishTargetKey( provider, id )
									);
									setChangingDestination( false );
									backFromExistingSite();
								} }
							/>
						) : previewMenuOpen && previewMenu ? (
							previewMenu
						) : preview.overwrite && ! remote ? (
							<PreviewOverwriteConfirmation preview={ preview } inline returnFocus={ trigger } />
						) : (
							publishContent
						) }
					</div>
				</Popover.Popup>
			</Popover.Root>
			{ previewOverwrite && (
				<PreviewOverwriteConfirmation
					preview={ preview }
					inline={ false }
					returnFocus={ trigger }
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
								{ __( 'Create preview' ) }
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) }
			{ publishConfirmation && selected && remote && (
				<LiveSiteAction
					site={ site }
					provider={ selected.provider }
					remote={ remote }
					disabled={ disabled }
					confirmation={ publishConfirmation }
					onBack={ () => setPublishConfirmation( undefined ) }
					returnFocus={ trigger }
				/>
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
					openSettings( 'providers' );
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
					previewName={ pullPreview.name }
					provider={ pullPreview.provider }
					disabled={ disabled }
					onClose={ () => {
						setPullPreview( undefined );
						trigger.current?.focus();
					} }
				/>
			) }
			{ removeTarget?.remote && (
				<DisconnectSiteDialog
					siteId={ site.id }
					provider={ removeTarget.provider }
					remote={ removeTarget.remote }
					returnFocus={ trigger }
					onClose={ () => setRemoveTarget( undefined ) }
					onDisconnected={ () => {
						targets.select( null );
						setRemoveTarget( undefined );
						setOpen( true );
					} }
				/>
			) }
		</>
	);
}
