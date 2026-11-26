import { getQualifyingLiveSites } from '@studio/common/lib/live-preview-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	Alert,
	AlertTitle,
	AlertDescription,
	AlertActions,
	Button,
	NotificationDot,
	Popover,
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
} from '@studio/ds';
import { useOffline, useSubmitFeedback } from '@studio/ds/hooks';
import { GlobeIcon, PlusIcon, ExternalLinkIcon, ChevronRightIcon } from '@studio/ds/icons';
import {
	getProvider,
	getProviderSites,
	type ProviderSites,
	type SiteCreationVisibility,
	type SitesProviderId,
} from '@studio/providers';
import { useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
import { getProviderUi } from '@studio/providers/ui';
import { useConnector, type SiteDetails, type Snapshot, SyncSite } from '@/data/core';
import { useAiSettings, useSpacefastConnection } from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import {
	accountSitesQueryKey,
	publishTargetQueryKey,
	remotePublishTargetKey,
	remoteSitesQueryKey,
	useConnectedHostingProviders,
} from '@/data/queries/use-remote-sites';
import { useSiteVisibility } from '@/data/queries/use-site-visibility';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import { usePushSite, useSyncNoticeVisibility } from '@/data/queries/use-sync-site';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { getSnapshotHostname, getSnapshotUrl } from '@/data/snapshot-url';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { useOpenSettings } from '@/data/use-open-settings';
import { SpacefastConnectDialog } from '@/features/account';
import { PreviewManagementDialog, type PreviewManagementAction } from '@/features/sharing';
import { clearPublishSetupError, retryPublishSetup, usePublishSetupError } from '@/features/sync';
import { ChangesIcon } from './changes-icon';
import { ConnectSiteIcon } from './connection-icons';
import { DestinationActionsMenu } from './destination-actions-menu';
import { DestinationChooser } from './destination-chooser';
import { DestinationRow } from './destination-row';
import { DisconnectSiteDialog } from './disconnect-site-dialog';
import { connectExistingSiteKey, ExistingSiteStep } from './existing-site-step';
import {
	HostedAccessControl,
	PreviewAccessControl,
	SiteCreationAccessControl,
} from './hosted-access-control';
import { LiveSiteAction } from './live-site-action';
import { isNewDestination } from './new-destination';
import { PreviewExpiry } from './preview-expiry';
import { PreviewOverwriteConfirmation } from './preview-overwrite-confirmation';
import { PreviewTransferActions } from './preview-transfer-actions';
import { ProviderPicker, rememberPublishProvider, defaultPublishProvider } from './provider-picker';
import { PublishedTime } from './published-time';
import { PullPreviewDialog } from './pull-preview-dialog';
import { getShareViewTitle, shareEntryView } from './share-view';
import { SiteDeliveryStep } from './site-delivery-step';
import styles from './style.module.css';
import { SelectRow } from './select-row';
import { usePublishNavigation } from './use-publish-navigation';
import { usePublishPreview } from './use-publish-preview';
import { usePublishTargets, type PublishTarget } from './use-publish-targets';
import type { ShareView } from './share-view';

type PullRequest = { provider?: SitesProviderId; remoteSiteId?: string | number };
type PendingPublishSignIn = { siteId: string; view: ShareView; publicPreviewKey?: string };

const PUBLISH_SIGN_IN_KEY = 'studio-publish-sign-in';
const noNewSiteInput: Record< string, string > = {};

function readPendingSignIn(): PendingPublishSignIn | undefined {
	try {
		const value = window.sessionStorage.getItem( PUBLISH_SIGN_IN_KEY );
		if ( ! value ) return undefined;
		const pending = JSON.parse( value ) as PendingPublishSignIn;
		return typeof pending.siteId === 'string' && pending.view?.kind ? pending : undefined;
	} catch {
		return undefined;
	}
}

function storePendingSignIn( pending?: PendingPublishSignIn ) {
	try {
		if ( pending ) window.sessionStorage.setItem( PUBLISH_SIGN_IN_KEY, JSON.stringify( pending ) );
		else window.sessionStorage.removeItem( PUBLISH_SIGN_IN_KEY );
	} catch {
		// The in-memory handoff still works when session storage is unavailable.
	}
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
	const [ showingSpacefast, setShowingSpacefast ] = useState( false );
	const spacefastVisible = useRef( false );
	const pendingSignIn = useRef< PendingPublishSignIn >( undefined );
	const { view, setView, navigate, section, backButton } = usePublishNavigation();
	const connecting = useIsMutating( { mutationKey: connectExistingSiteKey( site.id ) } ) > 0;
	const contentView = view.kind === 'existing' ? view.returnTo : view;
	const [ pullRequest, setPullRequest ] = useState< PullRequest >();
	const targets = usePublishTargets(
		site.id,
		open,
		contentView.kind === 'details' ? contentView.targetKey : undefined,
		contentView.kind === 'details' ? contentView.previewSiteId : undefined
	);
	const user = useAuthUser();
	const accounts = useAiSettings();
	const { data: preferences } = useUserPreferences();
	const openSettings = useOpenSettings();
	const accountsReady = user.data !== undefined && accounts.data !== undefined;
	const accountsFailed = ! accountsReady && ( user.isError || accounts.isError );
	const { connected: connectedProviders } = useConnectedHostingProviders( targets.providers );
	const stagedSite = useRef< {
		provider: SitesProviderId;
		siteId: string;
		remote: ProviderSites[ SitesProviderId ];
		visibility?: SiteCreationVisibility;
		input: Record< string, string >;
	} >( undefined );
	const [ preparing, setPreparing ] = useState< 'checkout' | 'create' | 'confirm' >();
	const publishingNewSite = preparing === 'create' || preparing === 'confirm';
	const addingDestination = contentView.kind === 'setup' && !! contentView.returnTo;
	const selected =
		! publishingNewSite && ( contentView.kind === 'details' || ( ! open && view.kind === 'entry' ) )
			? targets.selected
			: undefined;
	const hasLiveSite = targets.siteTargets.length > 0;
	const snapshot = selected?.snapshot;
	const remote = selected?.remote;
	const descriptor = selected ? getProviderSites( selected.provider ) : undefined;
	const targetsUnavailable = targets.previewsUnavailable || targets.unavailableProviders.length > 0;
	useLayoutEffect( () => {
		if ( ! open || ! accountsReady || targets.loadingTargets ) return;
		if ( view.kind === 'entry' ) {
			const request = view.target;
			const requested =
				request &&
				targets.targets.find(
					( target ) =>
						target.remote?.id === request.remoteSiteId &&
						( ! request.provider || target.provider === request.provider )
				);
			const next = requested
				? {
						kind: 'details' as const,
						targetKey: requested.key,
						returnTo:
							targets.targets.length > 1
								? { kind: 'chooser' as const, focusKey: requested.key }
								: undefined,
				  }
				: view.target
				? { kind: 'chooser' as const, unavailableTarget: true }
				: shareEntryView( targets.targets, targetsUnavailable );
			if ( next.kind === 'details' ) targets.select( targets.findTarget( next.targetKey )! );
			setView( next );
		} else if (
			view.kind === 'chooser' &&
			! view.unavailableTarget &&
			! pullRequest &&
			! targetsUnavailable &&
			! targets.refreshingTargets &&
			( ! targets.targets.length ||
				( view.autoSelectPreview &&
					targets.targets.length === 1 &&
					!! targets.targets[ 0 ].snapshot ) )
		) {
			const next = shareEntryView( targets.targets, false );
			if ( next.kind === 'details' ) targets.select( targets.targets[ 0 ] );
			setView( next );
		} else if ( view.kind === 'details' && contentView.kind === 'details' && ! publishingNewSite ) {
			const current = targets.findTarget( contentView.targetKey );
			if ( ! current && ! targets.refreshingTargets ) {
				setView(
					targets.targets.length || targetsUnavailable ? { kind: 'chooser' } : { kind: 'setup' }
				);
			} else if ( current && current.key !== contentView.targetKey ) {
				targets.select( current );
				setView( { ...contentView, targetKey: current.key } );
			}
		}
	}, [
		open,
		accountsReady,
		targets,
		targetsUnavailable,
		view,
		contentView,
		publishingNewSite,
		pullRequest,
		setView,
	] );
	const newDestination = isNewDestination( remote );
	const liveSites = getQualifyingLiveSites(
		targets.targets.flatMap( ( target ) =>
			target.remote && getProviderSites( target.provider ).previews
				? [ target.remote as SyncSite ]
				: []
		)
	);
	useSyncNoticeVisibility( site.id, open, true );
	const preview = usePublishPreview(
		site,
		snapshot ?? targets.selectedPreview?.snapshot,
		open && view.kind === 'details' && !! snapshot,
		open || !! snapshot
	);
	const visibilityLink = remote && descriptor?.visibility?.manage( remote );
	const visibility = useSiteVisibility(
		selected?.provider ?? targets.providers[ 0 ],
		remote?.id,
		!! remote && !! selected && connectedProviders.includes( selected.provider )
	);
	const remoteUrl = visibility.query.data?.url ?? remote?.url;
	const creationErrorNotice = `publish-create-${ site.id }`;
	const { feedback: creationFeedback, shake: showCreationFeedback } = useSubmitFeedback();
	const activity = useSiteSyncActivity( site.id );
	const setupError = usePublishSetupError( site.id );
	const offline = useOffline();
	const busy = useIsSiteBusy( site );
	const push = usePushSite();
	const [ publishProvider, setPublishProvider ] = useState< SitesProviderId >();
	const [ publicPreviewKey, setPublicPreviewKey ] = useState< string >();
	const defaultProvider = preferences?.defaultHostingProvider;
	const emptyDestination =
		( publishProvider && targets.providers.includes( publishProvider )
			? publishProvider
			: undefined ) ??
		( defaultProvider && connectedProviders.includes( defaultProvider )
			? defaultProvider
			: undefined ) ??
		defaultPublishProvider( connectedProviders ) ??
		targets.providers[ 0 ];
	const emptyDescriptor = getProviderSites( emptyDestination );
	useEffect( () => {
		if ( user.data === undefined || user.isFetching ) return;
		const pendingInMemory = pendingSignIn.current;
		const pending = pendingInMemory ?? readPendingSignIn();
		if ( ! pending ) return;
		if ( pending.siteId !== site.id || ( ! user.data && ! pendingInMemory ) ) {
			pendingSignIn.current = undefined;
			storePendingSignIn();
			return;
		}
		if ( ! user.data ) return;
		pendingSignIn.current = undefined;
		storePendingSignIn();
		setPublishProvider( 'wpcom' );
		if ( ! pendingInMemory ) setPublicPreviewKey( pending.publicPreviewKey );
		setView( pending.view );
		setOpen( true );
	}, [ site.id, user.data, user.isFetching, setView ] );
	useEffect(
		() => () => {
			if ( pendingSignIn.current ) storePendingSignIn();
		},
		[ site.id ]
	);
	const panelTitle = accountsReady ? getShareViewTitle( view, selected ) : __( 'Publish' );
	const destinationProvider = selected?.provider ?? emptyDestination;
	const connection = targets.connectionState( destinationProvider );
	const { learnMoreUrl } = getProviderSites( destinationProvider ).intro;
	const connectionUnavailable = ! selected && connection.unavailable;
	const canCreate = ! selected && emptyDescriptor.newSite === 'create';
	const [ requestedVisibility, setRequestedVisibility ] = useState< SiteCreationVisibility >();
	const [ newSiteInput, setNewSiteInput ] = useState( noNewSiteInput );
	const canCreateHere = canCreate && connectedProviders.includes( emptyDestination );
	const { NewSiteRows } = getProviderUi( emptyDestination );
	const runNewSiteAction = useCallback(
		( action: string, input?: Record< string, string > ) =>
			connector.runSitesAction( emptyDestination, action, input ),
		[ connector, emptyDestination ]
	);
	const creationPolicy = useQuery( {
		queryKey: [ 'site-creation-visibility', emptyDestination, newSiteInput ],
		queryFn: () => connector.getSiteCreationVisibility( emptyDestination, newSiteInput ),
		enabled: open && canCreateHere,
		retry: false,
		meta: { persist: false },
	} );
	const showCreationAccess = canCreate && creationPolicy.data !== null;
	const creationVisibility =
		creationPolicy.data === 'public'
			? requestedVisibility ?? 'private'
			: creationPolicy.data ?? undefined;
	const previewConnection =
		targets.previewProvider && targets.connectionState( targets.previewProvider );
	const previewConnectionUnavailable = !! (
		previewConnection?.loading || previewConnection?.unavailable
	);
	const creationAccessUnavailable =
		showCreationAccess && ( creationPolicy.isError || ! creationVisibility );
	const canPullLiveTarget = ( target: PublishTarget | undefined ) => {
		if (
			! target?.remote ||
			isNewDestination( target.remote ) ||
			! connectedProviders.includes( target.provider )
		)
			return false;
		const sites = getProviderSites( target.provider );
		return !! sites.pull && ! sites.issue?.( target.remote, 'pull' );
	};
	const pullTarget =
		pullRequest &&
		targets.targets.find(
			( target ) =>
				!! target.remote &&
				canPullLiveTarget( target ) &&
				( ! pullRequest.provider || target.provider === pullRequest.provider ) &&
				( pullRequest.remoteSiteId === undefined || target.remote.id === pullRequest.remoteSiteId )
		);
	const showLivePull = !! pullTarget?.remote && accountsReady && ! targets.loadingConnections;
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
			setView( { kind: 'entry' } );
		}
	}, [ preparing, activity?.kind, targets.confirmingPublish, setView ] );
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
	const destinationTrigger = useRef< HTMLButtonElement >( null );
	const targetActionsTrigger = useRef< HTMLButtonElement >( null );
	const addDestinationTrigger = useRef< HTMLButtonElement >( null );
	const connectExistingSiteTrigger = useRef< HTMLButtonElement >( null );
	const linkedSiteTrigger = useRef< HTMLButtonElement >( null );
	const pullButton = useRef< HTMLButtonElement >( null );
	const updateButton = useRef< HTMLButtonElement >( null );
	const transferOrigin = useRef< 'pull' | 'update' | 'menu' | 'trigger' >( 'menu' );
	const transferFocus = () =>
		transferOrigin.current === 'trigger'
			? trigger.current
			: ( transferOrigin.current === 'pull'
					? pullButton.current
					: transferOrigin.current === 'update'
					? updateButton.current
					: null ) ??
			  targetActionsTrigger.current ??
			  trigger.current;
	const publishMain = useRef< HTMLDivElement >( null );
	const showExistingSite = ( provider?: SitesProviderId ) => {
		if ( view.kind === 'setup' || view.kind === 'chooser' )
			navigate(
				{
					kind: 'existing',
					provider,
					returnTo:
						view.kind === 'chooser'
							? { ...view, autoSelectPreview: undefined, focusKey: 'connect-existing' }
							: view,
				},
				'forward'
			);
	};
	const backFromExistingSite = () => {
		if ( view.kind !== 'existing' ) return;
		const returnFocus =
			view.returnTo.kind === 'chooser' ? connectExistingSiteTrigger : destinationTrigger;
		navigate(
			view.returnTo,
			'back',
			() => ( returnFocus.current ?? publishMain.current )?.focus()
		);
	};
	const backFromDetails = () => {
		if ( view.kind !== 'details' || ! view.returnTo ) return;
		const parent = view.returnTo;
		preview.cancelOverwrite();
		if ( parent.kind !== 'chooser' ) {
			const target = targets.findTarget( parent.targetKey );
			if ( target ) targets.select( target );
		}
		navigate(
			parent,
			'back',
			parent.kind !== 'chooser' ? () => linkedSiteTrigger.current?.focus() : undefined
		);
	};
	const backFromPreviewSetup = () => {
		if ( contentView.kind !== 'setup' || ! contentView.returnTo ) return;
		navigate(
			contentView.returnTo.kind === 'chooser'
				? { kind: 'chooser', focusKey: 'add-destination' }
				: contentView.returnTo,
			'back',
			() => addDestinationTrigger.current?.focus()
		);
		setPublicPreviewKey( undefined );
		setRequestedVisibility( undefined );
		setNewSiteInput( noNewSiteInput );
		setFailure( undefined );
	};
	const showDestinationSetup = () => {
		if ( contentView.kind !== 'details' && contentView.kind !== 'chooser' ) return;
		publishMain.current?.focus();
		setPublicPreviewKey( undefined );
		setRequestedVisibility( undefined );
		setNewSiteInput( noNewSiteInput );
		setFailure( undefined );
		navigate( { kind: 'setup', returnTo: contentView }, 'forward' );
	};
	const [ previewLiveSite, setPreviewLiveSite ] = useState< string >();
	const [ publishConfirmation, setPublishConfirmation ] = useState< 'changes' | 'again' >();
	const openingTargetDialog = !! (
		showLivePull ||
		pullPreview ||
		previewAction ||
		removeTarget ||
		previewLiveSite !== undefined ||
		publishConfirmation ||
		showingSpacefast
	);
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
	const selectedSignedOut = !! selected && ! connectedProviders.includes( selected.provider );
	const resetClosedOptions = () => {
		setPublicPreviewKey( undefined );
		if ( ! publishingNewSite ) {
			setRequestedVisibility( undefined );
			setNewSiteInput( noNewSiteInput );
			if ( selected ) setPublishProvider( undefined );
		}
	};
	const requestHandler = useRef(
		( _request: {
			provider?: SitesProviderId;
			remoteSiteId?: string | number;
			view?: string;
		} ) => {}
	);
	useEffect( () => {
		requestHandler.current = ( request ) => {
			if ( ! open ) resetClosedOptions();
			if ( request.view === 'pull' ) transferOrigin.current = 'trigger';
			setPullRequest( request.view === 'pull' ? request : undefined );
			if ( ! creatingPreview && ! publishingNewSite )
				setView( {
					kind: 'entry',
					target:
						request.remoteSiteId === undefined
							? undefined
							: {
									provider: request.provider,
									remoteSiteId: request.remoteSiteId,
							  },
				} );
			setOpen( true );
		};
	} );
	useEffect( () => {
		const share = subscribeHeaderPanelRequest( site.id, 'share', () => {
			requestHandler.current( {} );
		} );
		const publish = subscribeHeaderPanelRequest( site.id, 'publish', ( request ) =>
			requestHandler.current( request )
		);
		return () => {
			share();
			publish();
		};
	}, [ site.id ] );
	const canRequestPreview = preview.canCreate || preview.limitReached;
	const createPreviewLabel = __( 'Create preview' );
	const previewOverwrite = preview.overwrite;
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
			setView( { kind: 'entry' } );
			activePreviewCreation.current = undefined;
		}
		setPreviewsBeforeCreation( undefined );
	}, [
		newPreviewSnapshot,
		preview.creationSettled,
		previewsBeforeCreation,
		resetPreviewCreation,
		selectCreatedPreview,
		setView,
	] );
	const hasChanges = targets.targets.some( targets.hasChanges );
	const upToDate = ! newDestination && targets.selectedStatus?.data?.localChanged === false;
	const url = snapshot ? getSnapshotUrl( snapshot ) : remoteUrl;
	const hostname = url ? new URL( url ).hostname : undefined;
	const publicDestination = snapshot ? selected!.provider : emptyDestination;
	const publicDescriptor = getProviderSites( publicDestination );
	const publicProviderLabel = getProvider( publicDestination ).label;
	const previewLaunchUrl = snapshot?.liveSiteId ? undefined : snapshot?.launchUrl;
	const showPreviewAccess =
		publicDescriptor.newSite === 'checkout' &&
		( selected
			? !! previewLaunchUrl && connectedProviders.includes( publicDestination )
			: !! publicDescriptor.previews );
	const previewAccessKey = selected?.key ?? emptyDestination;
	const previewPublicSelected = showPreviewAccess && publicPreviewKey === previewAccessKey;
	const SiteRows = selected && getProviderUi( selected.provider ).SiteRows;
	const linkedSite =
		snapshot?.liveSiteId &&
		targets.siteTargets.find(
			( target ) =>
				target.provider === selected?.provider && target.remote?.id === snapshot.liveSiteId
		);
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
	const close = () => {
		pendingSignIn.current = undefined;
		storePendingSignIn();
		preview.cancelOverwrite();
		setOpen( false );
		setPullRequest( undefined );
	};
	const select = ( target: PublishTarget ) => {
		if ( contentView.kind !== 'chooser' && contentView.kind !== 'details' ) return;
		activePreviewCreation.current = undefined;
		preview.cancelOverwrite();
		setPullRequest( undefined );
		targets.select( target );
		navigate(
			{
				kind: 'details',
				targetKey: target.key,
				previewSiteId: target.snapshot?.atomicSiteId,
				returnTo:
					contentView.kind === 'chooser' ? { kind: 'chooser', focusKey: target.key } : contentView,
			},
			'forward'
		);
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
				if ( activePreviewCreation.current === beforeCreation ) setView( { kind: 'entry' } );
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
			input = noNewSiteInput,
			entryPoint = 'publish',
		}: {
			visibility?: SiteCreationVisibility;
			input?: Record< string, string >;
			entryPoint?: 'publish' | 'launch';
		} = {}
	) => {
		const sites = getProviderSites( provider );
		if ( ! connectedProviders.includes( provider ) ) {
			selectProvider( provider );
			return;
		}
		rememberPublishProvider( provider );
		setPublishProvider( provider );
		setFailure( undefined );
		setPreparing( sites.newSite );
		let createdSite = false;
		try {
			if ( sites.newSite === 'checkout' ) {
				const checkoutUrl = snapshot ? previewLaunchUrl : connector.getPublishCheckoutUrl( site );
				if ( ! checkoutUrl ) {
					setFailure( __( 'Could not open the setup page. Please try again.' ) );
					return;
				}
				clearPublishSetupError( site.id );
				void connector.trackEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE, { entry_point: entryPoint } );
				if ( ! snapshot ) {
					void connector.watchForPublishedSite?.( site.id ).catch( () => {
						toast.error( __( 'Could not watch for your new site. Please try again.' ) );
					} );
				}
				await connector.openExternalUrl( checkoutUrl );
				if ( snapshot ) setPublicPreviewKey( undefined );
			} else if ( sites.newSite === 'create' ) {
				const staged = stagedSite.current;
				const remote =
					staged?.siteId === site.id &&
					staged.provider === provider &&
					staged.visibility === visibility &&
					staged.input === input
						? staged.remote
						: await connector.createRemoteSite(
								provider,
								site.id,
								{ name: site.name, visibility, input },
								false
						  );
				stagedSite.current = { provider, siteId: site.id, remote, visibility, input };
				dismissToast( creationErrorNotice );
				try {
					await push.mutateAsync( { provider, siteId: site.id, remoteSiteId: remote.id } );
				} catch {
					// The sync activity already reports transfer failures.
					return;
				}
				await connector.connectRemoteSite( provider, site.id, remote );
				stagedSite.current = undefined;
				await Promise.all(
					targets.providers.map( ( id ) =>
						client.invalidateQueries( { queryKey: remoteSitesQueryKey( id, site.id ) } )
					)
				);
				client.setQueryData(
					publishTargetQueryKey( site.id ),
					remotePublishTargetKey( provider, remote.id )
				);
				createdSite = true;
				void client.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
			} else {
				setFailure( __( 'This destination cannot create a site from this panel yet.' ) );
			}
		} catch ( error ) {
			if ( sites.newSite === 'create' ) void creationPolicy.refetch();
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
		setPublicPreviewKey( undefined );
		setRequestedVisibility( undefined );
		setNewSiteInput( noNewSiteInput );
		setFailure( undefined );
		setPublishProvider( provider );
	};
	const chooseDestination = ( provider: SitesProviderId ) => {
		pendingSignIn.current = undefined;
		storePendingSignIn();
		chooseProvider( provider );
	};
	// The popover reopens when the Spacefast dialog closes. Its content mounts
	// later than any fixed frame on a slow machine, so the popover focuses it.
	const focusDestinationOnOpen = useRef( false );
	const restoreDestinationFocus = () => {
		focusDestinationOnOpen.current = true;
	};
	const popoverInitialFocus = () => {
		if ( ! focusDestinationOnOpen.current ) return false;
		focusDestinationOnOpen.current = false;
		return destinationTrigger.current ?? backButton.current ?? trigger.current;
	};
	const spacefast = useSpacefastConnection( () => {
		if ( ! spacefastVisible.current ) return;
		spacefastVisible.current = false;
		chooseProvider( 'spacefast' );
		setShowingSpacefast( false );
		restoreDestinationFocus();
	} );
	const wpcomLogin = useLogin( {
		signup: true,
		source: 'previews_tab',
		analytics: { placement: 'share', intent: 'share' },
		scope: site.id,
	} );
	const selectProvider = ( provider: SitesProviderId ) => {
		if ( provider === 'wpcom' && wpcomLogin.isPending ) return;
		pendingSignIn.current = undefined;
		storePendingSignIn();
		if ( connectedProviders.includes( provider ) ) {
			chooseProvider( provider );
		} else if ( provider === 'spacefast' ) {
			spacefastVisible.current = true;
			setShowingSpacefast( true );
			spacefast.start();
		} else if ( provider === 'wpcom' ) {
			const publicPreview = previewPublicSelected && publicDestination === provider;
			if ( publicPreview ) setPublishProvider( provider );
			else chooseProvider( provider );
			const attempt = {
				siteId: site.id,
				view,
				publicPreviewKey: publicPreview ? previewAccessKey : undefined,
			};
			pendingSignIn.current = attempt;
			storePendingSignIn( attempt );
			wpcomLogin.mutate( undefined, {
				onError: ( error ) => {
					if ( pendingSignIn.current !== attempt ) return;
					pendingSignIn.current = undefined;
					storePendingSignIn();
					toast.error( __( 'Could not connect to WordPress.com' ), {
						description: error.message,
					} );
				},
			} );
		} else {
			close();
			openSettings( 'providers' );
		}
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
	const previewPullIssue =
		targets.previewAccountSite && descriptor?.issue?.( targets.previewAccountSite, 'pull' );
	const canPullPreview = !! (
		snapshot &&
		descriptor?.pull &&
		targets.previewAccountSite &&
		targets.selectedAccount?.isSuccess &&
		! previewPullIssue &&
		connectedProviders.includes( selected!.provider )
	);
	const comparison = preview.status.isSuccess ? preview.status.data : undefined;
	const previewMayHaveChanges = comparison?.previewChanged !== false;
	const showPreviewPull = canPullPreview && previewMayHaveChanges && ! previewPublicSelected;
	const pushIssue = remote && descriptor?.issue?.( remote, 'push' );
	const showLivePullAction = canPullLiveTarget( selected );
	const pullIsPrimary = showLivePullAction && !! pushIssue;
	const openPreviewPull = ( fromMenu = false ) => {
		if ( ! selected || ! snapshot || ! canPullPreview || disabled ) return;
		transferOrigin.current = fromMenu ? 'menu' : 'pull';
		setPullPreview( { provider: selected.provider, name: selected.label, snapshot } );
	};
	const updatePreview = () => {
		transferOrigin.current = 'update';
		void preview.updatePreview( snapshot );
	};
	const showAddDestination =
		view.kind === 'chooser' ||
		( view.kind === 'details' && ! view.returnTo && selected && targets.providers.length > 0 );
	const addDestinationRow = showAddDestination && (
		<DestinationRow
			ref={ addDestinationTrigger }
			icon={ <PlusIcon /> }
			label={ __( 'Publish somewhere else' ) }
			trailing={ <ChevronRightIcon data-navigation-chevron /> }
			disabled={ disabled }
			onClick={ showDestinationSetup }
		/>
	);
	const connectExistingSiteRow = (
		<DestinationRow
			ref={ connectExistingSiteTrigger }
			icon={ <ConnectSiteIcon /> }
			label={ __( 'Connect to an existing site' ) }
			trailing={ <ChevronRightIcon data-navigation-chevron /> }
			disabled={ disabled }
			onClick={ () => showExistingSite() }
		/>
	);
	const destinationsFeedback = ( targetsUnavailable ||
		missingPullTarget ||
		( view.kind === 'chooser' && view.unavailableTarget ) ) && (
		<Alert className={ styles.changeStatus }>
			<AlertTitle>
				{ targetsUnavailable
					? __( 'Some destinations could not be loaded' )
					: __( 'The requested site is unavailable.' ) }
			</AlertTitle>
			<AlertDescription>
				{ [
					targets.previewsUnavailable && __( 'Couldn’t load your previews.' ),
					...targets.unavailableProviders.map( ( provider ) =>
						sprintf(
							/* translators: %s: hosting provider name. */
							__( 'Couldn’t load your %s sites.' ),
							getProvider( provider ).label
						)
					),
				]
					.filter( Boolean )
					.join( ' ' ) }
			</AlertDescription>
			{ targetsUnavailable && (
				<AlertActions>
					<Button
						variant="outline"
						loading={ targets.refreshingTargets }
						disabled={ targets.refreshingTargets }
						onClick={ targets.retryUnavailable }
					>
						{ __( 'Try again' ) }
					</Button>
				</AlertActions>
			) }
		</Alert>
	);
	const launchButton = showPreviewAccess && (
		<Button
			className={ styles.launchButton }
			variant="outline"
			disabled={ disabled || connectionUnavailable }
			loading={ openingCheckout }
			aria-description={ openingCheckout ? openingDescription : undefined }
			onClick={ () => void startProvider( publicDestination, { entryPoint: 'launch' } ) }
		>
			{ sprintf(
				/* translators: %s: hosting provider name. */
				__( 'Launch on %s' ),
				publicProviderLabel
			) }
		</Button>
	);
	const renderPrimaryAction = () => {
		if ( publishingNewSite ) {
			return (
				<Button variant="accent" loading disabled>
					{ __( 'Publishing…' ) }
				</Button>
			);
		}
		if ( creatingPreview && ! remote ) {
			return (
				<Button variant="accent" loading disabled>
					{ __( 'Creating preview' ) }
				</Button>
			);
		}
		if ( ! connectedProviders.includes( destinationProvider ) ) {
			return (
				<Button
					variant="accent"
					disabled={ disabled }
					onClick={ () => selectProvider( destinationProvider ) }
				>
					{ selected || ! emptyDescriptor.previews
						? sprintf(
								/* translators: %s: hosting provider name. */
								__( 'Connect to %s' ),
								getProvider( destinationProvider ).label
						  )
						: previewPublicSelected
						? __( 'Connect to publish' )
						: __( 'Connect to share previews' ) }
				</Button>
			);
		}
		if ( ! selected && ! emptyDescriptor.newSite ) {
			return (
				<Button
					variant="accent"
					disabled={ disabled }
					onClick={ () => showExistingSite( emptyDestination ) }
				>
					{ __( 'Connect a site' ) }
				</Button>
			);
		}
		if ( ! selected && ! emptyDescriptor.previews ) {
			return (
				<Button
					variant={ creationFeedback ? 'destructive' : 'accent' }
					disabled={ disabled || connectionUnavailable || creationAccessUnavailable }
					onClick={ () =>
						void startProvider( emptyDestination, {
							visibility: creationVisibility,
							input: newSiteInput,
						} )
					}
				>
					{ __( 'Publish' ) }
				</Button>
			);
		}
		if ( previewPublicSelected ) {
			return (
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
			);
		}
		if ( snapshot ) {
			return (
				<PreviewTransferActions
					previewMayHaveChanges={ previewMayHaveChanges }
					disabled={ ! preview.canUpdate || disabled }
					updating={ selectedPending }
					pullButton={ pullButton }
					updateButton={ updateButton }
					onPull={ showPreviewPull ? () => openPreviewPull() : undefined }
					onUpdate={ updatePreview }
				/>
			);
		}
		if ( remote ) {
			if ( pullingSelected ) {
				return (
					<Button variant="accent" loading disabled>
						{ __( 'Pulling changes…' ) }
					</Button>
				);
			}
			if ( disabled && ! selectedPending && ! preview.pending && ! creatingPreview ) {
				return (
					<p role="status" className={ styles.footerStatus }>
						{ offline ? __( "You're offline" ) : __( 'Another operation is in progress.' ) }
					</p>
				);
			}
			if ( pullIsPrimary ) {
				return null;
			}
			return (
				<LiveSiteAction
					site={ site }
					provider={ selected!.provider }
					remote={ remote }
					publishing={ selectedPending }
					disabled={ disabled }
					forceEntireSite={ newDestination }
					returnFocus={ updateButton }
					onConfirmPublish={
						newDestination || descriptor?.content === 'static'
							? undefined
							: () => setPublishConfirmation( upToDate ? 'again' : 'changes' )
					}
				/>
			);
		}
		return (
			<Button
				variant="accent"
				disabled={ ! canRequestPreview || disabled || connectionUnavailable }
				onClick={ () => newPreview() }
			>
				{ createPreviewLabel }
			</Button>
		);
	};
	const publishContent = (
		<>
			<div className={ styles.publishRows }>
				{ ! selected && (
					<ProviderPicker
						ref={ destinationTrigger }
						selectedProvider={ emptyDestination }
						providers={ targets.providers }
						onConnectExistingSite={ () => showExistingSite() }
						onSelect={ chooseDestination }
						disabled={ disabled }
					/>
				) }
				{ selected && url && hostname && (
					<div
						className={ styles.siteAddressRow }
						role="group"
						aria-disabled={ openingCheckout || undefined }
						aria-label={
							snapshot ? sprintf( __( 'Preview: %s' ), selected.label ) : selected.label
						}
					>
						<DestinationRow
							render={ <a href={ url } target="_blank" rel="noopener noreferrer" /> }
							nativeButton={ false }
							role="link"
							icon={ <GlobeIcon /> }
							label={ hostname }
							title={ hostname }
							aria-label={ sprintf(
								/* translators: %s: the preview or site hostname. */
								snapshot ? __( 'Open preview: %s' ) : __( 'Open %s' ),
								hostname
							) }
							disabled={ openingCheckout }
							onClick={ ( event ) => {
								event.preventDefault();
								void connector.openExternalUrl( url );
							} }
						/>
						{ ! ( preview.overwrite && ! remote ) && (
							<DestinationActionsMenu
								selected={ selected }
								url={ url }
								disabled={ disabled || selectedSignedOut }
								openingCheckout={ openingCheckout }
								openingDialog={ openingTargetDialog }
								triggerRef={ targetActionsTrigger }
								onPullPreview={
									canPullPreview && ! showPreviewPull ? () => openPreviewPull( true ) : undefined
								}
								onDeletePreview={ deletePreview }
								onDisconnect={ () => {
									close();
									setRemoveTarget( selected );
								} }
							/>
						) }
					</div>
				) }
				{ remote && visibility.query.data !== null && visibilityLink && descriptor?.visibility && (
					<HostedAccessControl
						state={ visibility }
						getOptions={ descriptor.visibility.options }
						disabled={ disabled || selectedSignedOut }
						fallback={ remote.visibility }
						managementLink={ visibilityLink }
					/>
				) }
				{ ( showPreviewAccess || snapshot ) && (
					<PreviewAccessControl
						publicSelected={ previewPublicSelected }
						readOnly={ ! showPreviewAccess }
						disabled={ disabled }
						onPublicSelectedChange={ ( next ) => {
							setPublicPreviewKey( next ? previewAccessKey : undefined );
							setFailure( undefined );
						} }
					/>
				) }
				{ linkedSite && (
					<DestinationRow
						ref={ linkedSiteTrigger }
						icon={ <ChangesIcon /> }
						label={ sprintf( __( 'Changes to %s' ), linkedSite.label ) }
						trailing={ <ChevronRightIcon data-navigation-chevron /> }
						disabled={ disabled }
						onClick={ () => select( linkedSite ) }
					/>
				) }
				{ remote && SiteRows && (
					<SiteRows
						site={ remote }
						disabled={ disabled }
						openUrl={ ( siteUrl ) => void connector.openExternalUrl( siteUrl ) }
						Row={ DestinationRow }
					/>
				) }
				{ canCreateHere && NewSiteRows && (
					<NewSiteRows
						input={ newSiteInput }
						disabled={ disabled }
						onChange={ setNewSiteInput }
						run={ runNewSiteAction }
						SelectRow={ SelectRow }
					/>
				) }
				{ showCreationAccess && emptyDescriptor.visibility && (
					<SiteCreationAccessControl
						value={ canCreateHere ? creationVisibility : 'private' }
						policy={ creationPolicy.data ?? undefined }
						loading={ creationPolicy.isFetching }
						disabled={ disabled || creationAccessUnavailable }
						getOptions={ emptyDescriptor.visibility.options }
						onChange={ setRequestedVisibility }
					/>
				) }
				{ addDestinationRow }
			</div>
			<div
				className={ styles.shareFooter }
				role="group"
				aria-label={ remote ? __( 'Published site actions' ) : __( 'Preview actions' ) }
			>
				{ ! addingDestination && ! previewPublicSelected && launchButton }
				{ showLivePullAction && ! pullingSelected && (
					<Button
						ref={ pullButton }
						variant={ pullIsPrimary ? 'accent' : 'outline' }
						disabled={ disabled }
						onClick={ () => {
							transferOrigin.current = 'pull';
							setPullRequest( { provider: selected!.provider, remoteSiteId: remote!.id } );
						} }
					>
						{ __( 'Pull from live site…' ) }
					</Button>
				) }
				{ ! addingDestination && ! remote && learnMoreUrl && (
					<Button
						variant="outline"
						onClick={ () => void connector.openExternalUrl( learnMoreUrl ) }
					>
						{ sprintf(
							/* translators: %s: a hosting provider, such as Spacefast */
							__( 'Learn about %s' ),
							getProvider( destinationProvider ).label
						) }
						<ExternalLinkIcon data-icon="inline-end" />
					</Button>
				) }
				<div className={ styles.footerActions }>{ renderPrimaryAction() }</div>
			</div>
			{ newDestination && (
				<p role="status" className={ styles.footerStatus }>
					{ __( 'Not published yet' ) }
				</p>
			) }
			{ ! selected && offline && (
				<p role="status" className={ styles.footerStatus }>
					{ __( "You're offline" ) }
				</p>
			) }
			{ snapshot && comparison?.previewChanged && (
				<p role="status" className={ styles.footerStatus }>
					{ comparison.localChanged === true
						? __( 'Local and preview changes' )
						: __( 'Preview has changes' ) }
				</p>
			) }
			{ showPreviewPull && comparison?.previewChanged && comparison.localChanged && (
				<p className={ styles.footerStatus }>
					{ __( 'Pull replaces your local copy. Update replaces the preview.' ) }
				</p>
			) }
			{ snapshot &&
				! canPullPreview &&
				( comparison?.previewChanged || targets.selectedAccount?.isError ) && (
					<p role="status" className={ styles.footerStatus }>
						{ targets.selectedAccount?.isError
							? __( 'Couldn’t check whether you can pull from this preview.' )
							: targets.selectedAccount?.isSuccess
							? previewPullIssue ??
							  __( 'Pulling from this preview is unavailable for this account.' )
							: __( 'Checking whether you can pull from this preview…' ) }
						{ targets.selectedAccount?.isError && (
							<>
								{ ' ' }
								<Button
									variant="inline-link"
									size="inline"
									onClick={ () => void targets.selectedAccount?.refetch() }
								>
									{ __( 'Try again' ) }
								</Button>
							</>
						) }
					</p>
				) }
			{ emptyDescriptor.previews &&
				! snapshot &&
				! remote &&
				! preview.loading &&
				preview.unavailable &&
				! preview.signedOut && (
					<p className={ styles.footerStatus }>
						{ preview.unavailable }{ ' ' }
						{ preview.availabilityError && (
							<Button variant="inline-accent" size="inline" onClick={ preview.retryAvailability }>
								{ __( 'Retry' ) }
							</Button>
						) }
					</p>
				) }
			{ setupError && (
				<p role="alert" className={ styles.footerStatus }>
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
				<p role="alert" className={ styles.footerStatus }>
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
				<p role="alert" className={ styles.footerStatus }>
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
				<p role="alert" className={ styles.footerStatus }>
					{ failure }
				</p>
			) }
			{ pullIsPrimary && (
				<p role="status" className={ styles.footerStatus }>
					{ pushIssue }
				</p>
			) }
			{ remote?.lastPushTimestamp && <PublishedTime timestamp={ remote.lastPushTimestamp } /> }
			{ snapshot && <PreviewExpiry snapshot={ snapshot } /> }
		</>
	);

	const onBack =
		view.kind === 'existing'
			? backFromExistingSite
			: view.kind === 'setup' && view.returnTo
			? backFromPreviewSetup
			: view.kind === 'details' && view.returnTo
			? backFromDetails
			: undefined;
	return (
		<>
			<Popover.Root
				open={
					open &&
					! pullPreview &&
					! showLivePull &&
					previewLiveSite === undefined &&
					! publishConfirmation &&
					! previewAction &&
					! previewOverwrite &&
					! showingSpacefast
				}
				onOpenChange={ ( next, event ) => {
					if (
						! next &&
						pendingSignIn.current &&
						event.reason === 'focus-out' &&
						! ( event.event as FocusEvent ).relatedTarget
					) {
						event.cancel();
						return;
					}
					if ( ! next && view.kind === 'existing' && connecting ) {
						event.cancel();
						return;
					}
					if ( ! next && event.reason === 'escape-key' && onBack ) {
						event.cancel();
						if ( ! pending ) onBack();
						return;
					}
					const dismissalTarget =
						event.reason === 'focus-out'
							? ( event.event as FocusEvent ).relatedTarget
							: event.event.target;
					if (
						! next &&
						( event.reason === 'outside-press' || event.reason === 'focus-out' ) &&
						dismissalTarget instanceof Element &&
						dismissalTarget.closest( '[data-slot="toast-viewport"]' )
					) {
						event.cancel();
						return;
					}
					setOpen( next );
					if ( next ) {
						if ( ! open ) resetClosedOptions();
						if ( ! creatingPreview && ! publishingNewSite ) setView( { kind: 'entry' } );
						targets.refresh();
						if ( remote && ! selectedSignedOut ) void visibility.query.refetch();
					} else close();
				} }
				onOpenChangeComplete={ ( next ) => {
					if ( next || open ) return;
					if ( ! creatingPreview && ! publishingNewSite ) setView( { kind: 'entry' } );
					resetClosedOptions();
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
										aria-label={ __( 'Publish…' ) }
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
										<span>{ __( 'Publish' ) }</span>
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
					<TooltipContent>{ __( 'Share a preview or publish your site' ) }</TooltipContent>
				</Tooltip>
				<span
					ref={ anchor }
					className={ styles.publishAnchor }
					data-site-stopped={ ! site.running || undefined }
					aria-hidden="true"
				/>
				<Popover.Popup
					anchor={ anchor }
					aria-label={ panelTitle }
					sideOffset={ 0 }
					align="end"
					instant={ openingTargetDialog || !! previewOverwrite }
					backdrop
					className={ styles.publishPopover }
					initialFocus={ popoverInitialFocus }
					finalFocus={ openingTargetDialog || previewOverwrite ? false : undefined }
				>
					<div
						ref={ publishMain }
						tabIndex={ -1 }
						onKeyDownCapture={ ( event ) => {
							if (
								event.key !== 'Escape' ||
								event.defaultPrevented ||
								! ( event.target instanceof HTMLElement ) ||
								! event.currentTarget.contains( event.target ) ||
								event.target.closest( '[aria-expanded="true"]' )
							)
								return;
							event.preventDefault();
							event.stopPropagation();
							if ( onBack ) {
								if ( ! pending && ! connecting ) onBack();
							} else close();
						} }
					>
						<SiteDeliveryStep
							title={ panelTitle }
							titleClassName={
								view.kind === 'setup' && view.returnTo ? styles.previewStepTitle : undefined
							}
							section={ section }
							backButton={ backButton }
							onBack={ onBack }
							disabled={ pending || connecting }
						>
							{ accountsFailed ? (
								<Alert>
									<AlertTitle>{ __( 'Couldn’t load publishing accounts' ) }</AlertTitle>
									<AlertActions>
										<Button
											variant="outline"
											disabled={ user.isFetching || accounts.isFetching }
											onClick={ () => {
												if ( user.isError ) void user.refetch();
												if ( accounts.isError ) void accounts.refetch();
											} }
										>
											{ __( 'Try again' ) }
										</Button>
									</AlertActions>
								</Alert>
							) : ! accountsReady ||
							  view.kind === 'entry' ||
							  ( contentView.kind === 'details' && ! selected ) ? (
								<div
									role="status"
									aria-label={ __( 'Loading destinations' ) }
									className={ styles.destinationLoading }
								>
									<Skeleton />
									<Skeleton />
									<Skeleton />
								</div>
							) : view.kind === 'existing' ? (
								<ExistingSiteStep
									providers={ view.provider ? [ view.provider ] : connectedProviders }
									availableProviders={ view.provider ? [] : targets.providers }
									siteId={ site.id }
									replacing={ hasLiveSite }
									disabled={ disabled || wpcomLogin.isPending }
									onConnectProvider={ selectProvider }
									onShowConnectForm={
										view.provider
											? undefined
											: ( provider ) => navigate( { ...view, provider }, 'forward' )
									}
									onConnected={ ( provider, id ) => {
										client.setQueryData(
											publishTargetQueryKey( site.id ),
											remotePublishTargetKey( provider, id )
										);
										setView( { kind: 'entry', target: { provider, remoteSiteId: id } } );
									} }
								/>
							) : view.kind === 'chooser' ? (
								<DestinationChooser
									actionRows={
										<>
											{ addDestinationRow }
											{ connectExistingSiteRow }
										</>
									}
									targets={ targets.targets }
									hasChanges={ targets.hasChanges }
									focusKey={ view.focusKey }
									disabled={ pending }
									onSelect={ select }
									feedback={ destinationsFeedback }
								/>
							) : (
								publishContent
							) }
						</SiteDeliveryStep>
					</div>
				</Popover.Popup>
			</Popover.Root>
			<SpacefastConnectDialog
				open={ showingSpacefast }
				autoOpen
				pending={ spacefast.pending }
				isPending={ spacefast.isPending }
				error={ spacefast.error?.message }
				onRetry={ spacefast.start }
				onClose={ () => {
					spacefastVisible.current = false;
					setShowingSpacefast( false );
					restoreDestinationFocus();
				} }
			/>
			{ previewOverwrite && (
				<PreviewOverwriteConfirmation
					preview={ preview }
					onCancel={ () => {
						preview.cancelOverwrite();
						requestAnimationFrame( () => transferFocus()?.focus() );
					} }
					returnFocus={ transferFocus }
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
									<SelectItem
										key={ live.id }
										value={ String( live.id ) }
										description={ live.name ? new URL( live.url ).hostname : undefined }
									>
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
								{ createPreviewLabel }
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
					onBack={ () => {
						setPublishConfirmation( undefined );
						requestAnimationFrame( () => updateButton.current?.focus() );
					} }
					returnFocus={ updateButton }
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
						requestAnimationFrame( () => transferFocus()?.focus() );
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
					disabled={
						disabled ||
						! canPullPreview ||
						snapshot?.atomicSiteId !== pullPreview.snapshot.atomicSiteId
					}
					onClose={ () => {
						setPullPreview( undefined );
						requestAnimationFrame( () => transferFocus()?.focus() );
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
						setView( { kind: 'entry' } );
						setRemoveTarget( undefined );
						setOpen( true );
					} }
				/>
			) }
		</>
	);
}
