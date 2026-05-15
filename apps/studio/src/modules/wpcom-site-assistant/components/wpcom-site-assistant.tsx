import { AgentUI, ImageUploader, createMessageRenderer } from '@automattic/agenttic-ui';
import { Popover } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	chevronDown,
	chevronLeft,
	chevronRight,
	closeSmall,
	external,
	Icon,
	image as imageIcon,
	lockSmall,
	moreVertical,
	plus,
	rotateRight,
	trash,
} from '@wordpress/icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { ChatMessage } from 'src/components/chat-message';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { LIMIT_OF_PROMPTS_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { DollyPreviewPanel } from 'src/modules/wpcom-site-assistant/components/wpcom-site-preview-panel';
import {
	fetchDollySite,
	hydrateWpcomSiteAssistantConversationStates,
	resolveBackendSelectedSiteId,
} from 'src/modules/wpcom-site-assistant/lib/api';
import {
	DollyOptimisticImages,
	createDollyImagePrompt,
	createDollyPendingVisibleImages,
	createDollyVisibleMessage,
	preloadDollyImageUrls,
	readFileAsDataUrl,
	revokeDollyPendingImageUrls,
	uploadDollyImages,
} from 'src/modules/wpcom-site-assistant/lib/media';
import {
	createDollyPreviewAbilities,
	createPreviewContext,
	createWpcomOnlySiteAssociationContext,
	getNextPreviewState,
	normalizePreviewUrl,
} from 'src/modules/wpcom-site-assistant/lib/preview';
import {
	createNewWpcomSiteAssistantConversation,
	createWpcomSiteAssistantSessionKey,
	createWpcomSiteAssistantSessionState,
	deleteWpcomSiteAssistantConversation,
	getWpcomSiteAssistantConversationsForSite,
	getWpcomSiteAssistantSessionState,
	getWpcomSiteAssistantTargetPreviewState,
	mergeWpcomSiteAssistantConversationState,
	persistWpcomSiteAssistantSessionStateCache,
	setSelectedWpcomSiteAssistantConversationId,
	setWpcomSiteAssistantTargetPreviewState,
	wpcomSiteAssistantSessionStateCache,
} from 'src/modules/wpcom-site-assistant/lib/session';
import {
	createDollyManageStagingSiteAbility,
	getKnownStagingCreationBlocker,
	getStagingPlanUpgradeUrl,
	getStagingCreationErrorMessage,
	isStagingPlanUpgradeRequired,
} from 'src/modules/wpcom-site-assistant/lib/staging';
import {
	getErrorMessage,
	isDollyRequestAbortError,
	sendDollyMessage,
} from 'src/modules/wpcom-site-assistant/lib/transport';
import {
	abortWpcomSiteAssistantTurn,
	finishWpcomSiteAssistantTurn,
	getWpcomSiteAssistantTurn,
	startWpcomSiteAssistantTurn,
	useWpcomSiteAssistantTurn,
} from 'src/modules/wpcom-site-assistant/lib/turns';
import {
	DOLLY_AGENT_ID,
	DOLLY_IMAGE_FILE_TYPES,
	DOLLY_IMAGE_MAX_FILE_SIZE,
	DOLLY_IMAGE_MAX_FILES,
	type DollyMessageImageAttachment,
	type DollyPendingImage,
	type DollyPreviewState,
	type DollyUploadedImage,
	type OpenPreviewOptions,
	type WpcomSiteAssistantSessionState,
} from 'src/modules/wpcom-site-assistant/lib/types';
import {
	getWpcomSiteWorkspaceForSite,
	setSavedWpcomWorkspaceTarget,
	type WpcomSiteWorkspace,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import { generateMessage, Message as MessageType } from 'src/stores/chat-slice';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';
import type { ToolProvider } from '@automattic/agenttic-client';
import type {
	AgentUIProps,
	ImageUploaderHandle,
	NoticeConfig as AgentticNoticeConfig,
	UploadedImage,
} from '@automattic/agenttic-ui';
import type { SyncSite } from '@studio/common/types/sync';

export { clearWpcomSiteAssistantStateCacheForTests } from 'src/modules/wpcom-site-assistant/lib/session';

const OfflineModeView = () => {
	const offlineMessage = __( 'The AI assistant requires an internet connection.' );

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-frame-text-secondary gap-1">
			<Icon className="m-1 fill-frame-text-secondary" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ offlineMessage }</span>
		</div>
	);
};

const UnauthenticatedView = ( { onAuthenticate }: { onAuthenticate: () => void } ) => (
	<ChatMessage
		id="message-unauthenticated"
		className="w-full"
		message={ { role: 'user' } as MessageType }
		isUnauthenticated={ true }
		instanceId=""
	>
		<div data-testid="unauthenticated-header" className="mb-3 a8c-label-semibold">
			{ __( 'Hold up!' ) }
		</div>
		<div className="mb-1">
			{ __( 'You need to log in to your WordPress.com account to use the assistant.' ) }
		</div>
		<div className="mb-1">
			{ createInterpolateElement(
				__( "If you don't have an account yet, <a>create one for free</a>." ),
				{
					a: <Button variant="link" onClick={ () => getIpcApi().authenticate( true ) } />,
				}
			) }
		</div>
		<div className="mb-3">
			{ sprintf(
				__( 'Every account gets %d prompts included for free each month.' ),
				LIMIT_OF_PROMPTS_PER_USER
			) }
		</div>
		<Button variant="primary" onClick={ onAuthenticate }>
			{ __( 'Log in to WordPress.com' ) }
			<ArrowIcon />
		</Button>
	</ChatMessage>
);

const getCreateStagingSiteUnavailableMessage = ( site: SyncSite ) => {
	if ( site.isStaging ) {
		return __( 'This is already a staging site.' );
	}

	if ( site.stagingSiteIds?.length ) {
		return __( 'This production site already has a staging site.' );
	}

	if ( site.isPressable ) {
		return __( 'Staging-site creation is only available for WordPress.com sites.' );
	}

	return (
		getKnownStagingCreationBlocker( site ) ??
		__( 'A staging site cannot be created for this site.' )
	);
};

function WpcomTargetSwitcher( {
	workspace,
	selectedSite,
	onSelectSite,
	onCreateStagingSite,
	canCreateStagingSite,
	isCreatingStagingSite,
	stagingDisabledReason,
}: {
	workspace?: WpcomSiteWorkspace;
	selectedSite: SyncSite;
	onSelectSite: ( site: SyncSite ) => void;
	onCreateStagingSite: () => void;
	canCreateStagingSite: boolean;
	isCreatingStagingSite: boolean;
	stagingDisabledReason?: string;
} ) {
	const productionSite =
		workspace?.productionSite ?? ( selectedSite.isStaging ? undefined : selectedSite );
	const stagingSite =
		workspace?.stagingSites[ 0 ] ?? ( selectedSite.isStaging ? selectedSite : undefined );
	const isProductionSelected = productionSite?.id === selectedSite.id;
	const isStagingSelected = stagingSite?.id === selectedSite.id || selectedSite.isStaging;
	const isProductionDisabled = ! productionSite;
	const isStagingUpgradeAvailable = Boolean(
		productionSite && ! stagingSite && isStagingPlanUpgradeRequired( productionSite )
	);
	const isStagingDisabled =
		! stagingSite &&
		! isStagingUpgradeAvailable &&
		( ! canCreateStagingSite || isCreatingStagingSite );
	const productionTooltip = isProductionDisabled
		? __( 'Production site details are not available yet.' )
		: undefined;
	const stagingTooltip = isStagingUpgradeAvailable
		? __( "Upgrade this site's plan to add a staging site." )
		: stagingDisabledReason ??
		  ( isCreatingStagingSite ? __( 'Creating staging site...' ) : undefined );

	const getButtonClassName = ( isSelected: boolean, needsUpgrade = false ) =>
		cx(
			'inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme disabled:cursor-not-allowed disabled:opacity-60',
			needsUpgrade &&
				'border-dashed border-circle-env-staging bg-transparent text-frame-text-secondary hover:text-frame-text',
			isSelected
				? 'border-transparent bg-a8c-green-5 text-a8c-green-70'
				: ! needsUpgrade &&
						'border-transparent bg-frame-surface text-frame-text-secondary hover:text-frame-text'
		);

	return (
		<div className="flex items-center gap-2 whitespace-nowrap">
			<Tooltip text={ productionTooltip } disabled={ ! productionTooltip } placement="bottom-start">
				<button
					type="button"
					className={ getButtonClassName( Boolean( isProductionSelected ) ) }
					disabled={ isProductionDisabled }
					onClick={ () => productionSite && onSelectSite( productionSite ) }
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-circle-env-production" />
					{ __( 'Production' ) }
				</button>
			</Tooltip>
			<Tooltip text={ stagingTooltip } disabled={ ! stagingTooltip } placement="bottom-start">
				<button
					type="button"
					className={ getButtonClassName(
						Boolean( isStagingSelected ),
						isStagingUpgradeAvailable
					) }
					disabled={ isStagingDisabled }
					onClick={ () => {
						if ( stagingSite ) {
							onSelectSite( stagingSite );
							return;
						}

						if ( productionSite && isStagingUpgradeAvailable ) {
							getIpcApi().openURL( getStagingPlanUpgradeUrl( productionSite ) );
							return;
						}

						onCreateStagingSite();
					} }
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-circle-env-staging" />
					{ isCreatingStagingSite ? __( 'Creating staging...' ) : __( 'Staging' ) }
				</button>
			</Tooltip>
			<Tooltip
				text={ __( 'Local target support is not implemented yet.' ) }
				placement="bottom-start"
			>
				<button type="button" className={ getButtonClassName( false ) } disabled>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-a8c-gray-40" />
					{ __( 'Local' ) }
				</button>
			</Tooltip>
		</div>
	);
}

function DollyPreviewHeaderControls( {
	isOpen,
	displayUrl,
	previewUrl,
	canGoBack,
	canGoForward,
	onOpen,
	onClose,
	onGoBack,
	onGoForward,
	onRefresh,
}: {
	isOpen: boolean;
	displayUrl: string;
	previewUrl?: string;
	canGoBack?: boolean;
	canGoForward?: boolean;
	onOpen: () => void;
	onClose: () => void;
	onGoBack: () => void;
	onGoForward: () => void;
	onRefresh: () => void;
} ) {
	if ( ! isOpen ) {
		return (
			<button
				type="button"
				className="flex w-full min-w-0 max-w-[27rem] items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2 text-left transition hover:border-a8c-gray-20 hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				onClick={ onOpen }
				aria-label={ __( 'Show preview' ) }
			>
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<span className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</span>
			</button>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center justify-end gap-2">
			<Button
				variant="icon"
				tooltipText={ __( 'Go back' ) }
				disabled={ ! canGoBack }
				onClick={ onGoBack }
				aria-label={ __( 'Go back' ) }
			>
				<Icon icon={ chevronLeft } size={ 20 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Go forward' ) }
				disabled={ ! canGoForward }
				onClick={ onGoForward }
				aria-label={ __( 'Go forward' ) }
			>
				<Icon icon={ chevronRight } size={ 20 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Reload preview' ) }
				disabled={ ! previewUrl }
				onClick={ onRefresh }
				aria-label={ __( 'Reload preview' ) }
			>
				<Icon icon={ rotateRight } size={ 18 } />
			</Button>
			<div className="flex min-w-0 max-w-[27rem] flex-1 items-center gap-2 rounded-full border border-a8c-gray-5 bg-a8c-gray-0 px-3 py-2">
				<Icon icon={ lockSmall } size={ 16 } className="shrink-0 fill-frame-text-secondary" />
				<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
			</div>
			<Button
				variant="icon"
				tooltipText={ __( 'Open in browser' ) }
				disabled={ ! previewUrl }
				onClick={ () => getIpcApi().openURL( displayUrl ) }
				aria-label={ __( 'Open in browser' ) }
			>
				<Icon icon={ external } size={ 18 } />
			</Button>
			<Button
				variant="icon"
				tooltipText={ __( 'Close preview' ) }
				onClick={ onClose }
				aria-label={ __( 'Close preview' ) }
			>
				<Icon icon={ closeSmall } size={ 20 } />
			</Button>
		</div>
	);
}

const isBlankConversation = ( conversation: WpcomSiteAssistantSessionState ) =>
	conversation.messages.length === 0 && ! conversation.input.trim();

const getConversationUpdatedLabel = ( conversation: WpcomSiteAssistantSessionState ) =>
	new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	} ).format( new Date( conversation.lastUpdated ) );

const getConversationLabel = ( conversation: WpcomSiteAssistantSessionState ) => {
	const firstUserMessage = conversation.messages.find( ( message ) => message.role === 'user' );
	const fallbackDate = new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	} ).format( new Date( conversation.lastUpdated ) );

	if ( firstUserMessage?.content.trim() ) {
		return firstUserMessage.content.trim().replace( /\s+/g, ' ' ).slice( 0, 64 );
	}

	return sprintf( __( 'Chat from %s' ), fallbackDate );
};

const getConversationMenuLabel = ( conversation: WpcomSiteAssistantSessionState ) => {
	const label = getConversationLabel( conversation );
	const updated = getConversationUpdatedLabel( conversation );
	return `${ label } · ${ updated }`;
};

const shouldShowConversationControls = (
	conversations: WpcomSiteAssistantSessionState[],
	selectedConversation?: WpcomSiteAssistantSessionState
) => {
	if ( ! selectedConversation ) {
		return false;
	}

	return ! ( conversations.length === 1 && isBlankConversation( selectedConversation ) );
};

function DollyConversationMenu( {
	anchor,
	conversations,
	selectedConversationId,
	onClose,
	onNewChat,
	onSelect,
	onDelete,
	isConversationActive,
}: {
	anchor: Element | null;
	conversations: WpcomSiteAssistantSessionState[];
	selectedConversationId: string;
	onClose: () => void;
	onNewChat: () => void;
	onSelect: ( conversationId: string ) => void;
	onDelete: ( conversationId: string ) => void;
	isConversationActive: ( conversationId: string ) => boolean;
} ) {
	const menuRef = useRef< HTMLDivElement >( null );
	const selectedConversation =
		conversations.find( ( conversation ) => conversation.id === selectedConversationId ) ??
		conversations[ 0 ];

	useEffect( () => {
		if ( ! anchor ) {
			return;
		}

		const handlePointerDown = ( event: PointerEvent ) => {
			const target = event.target;
			if ( ! ( target instanceof Node ) ) {
				return;
			}

			if ( anchor?.contains( target ) || menuRef.current?.contains( target ) ) {
				return;
			}

			onClose();
		};

		document.addEventListener( 'pointerdown', handlePointerDown, true );
		return () => document.removeEventListener( 'pointerdown', handlePointerDown, true );
	}, [ anchor, onClose ] );

	if ( ! anchor || ! shouldShowConversationControls( conversations, selectedConversation ) ) {
		return null;
	}

	return (
		<Popover
			anchor={ anchor }
			placement="top-end"
			onClose={ onClose }
			resize
			shift
			offset={ 8 }
			focusOnMount={ false }
		>
			<div
				ref={ menuRef }
				role="menu"
				aria-label={ __( 'Chat options' ) }
				className="max-h-80 w-80 overflow-y-auto py-1"
			>
				{ conversations.map( ( conversation ) => {
					const isSelected = conversation.id === selectedConversationId;
					const isActive = isConversationActive( conversation.id );

					return (
						<div
							key={ conversation.id }
							className={ cx(
								'flex items-center gap-2 px-4 py-3 transition hover:bg-frame-surface',
								isSelected && 'bg-frame-surface'
							) }
						>
							<button
								type="button"
								role="menuitem"
								className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
								onClick={ () => {
									onSelect( conversation.id );
								} }
							>
								<span className="block truncate text-sm font-medium text-frame-text">
									{ getConversationLabel( conversation ) }
								</span>
								<span className="block truncate text-xs text-frame-text-secondary">
									{ getConversationUpdatedLabel( conversation ) }
								</span>
							</button>
							<Button
								variant="icon"
								className="h-8 w-8 shrink-0 text-frame-text-secondary hover:text-a8c-red-50"
								disabled={ isActive }
								aria-label={ sprintf(
									/* translators: %s is a Dolly chat label. */
									__( 'Delete chat: %s' ),
									getConversationMenuLabel( conversation )
								) }
								tooltipText={
									isActive ? __( 'Wait for Dolly to finish before deleting this chat.' ) : undefined
								}
								onClick={ () => {
									onDelete( conversation.id );
								} }
							>
								<Icon icon={ trash } size={ 18 } />
							</Button>
						</div>
					);
				} ) }
				<div className="mt-1 border-t border-a8c-gray-5 px-1 pt-1">
					<button
						type="button"
						role="menuitem"
						className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm font-medium text-frame-theme hover:bg-frame-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
						onClick={ () => {
							onNewChat();
							onClose();
						} }
					>
						<Icon icon={ plus } size={ 16 } />
						{ __( 'New chat' ) }
					</button>
				</div>
			</div>
		</Popover>
	);
}

interface WpcomSiteAssistantProps {
	selectedWpcomSite: SyncSite;
}

export function WpcomSiteAssistant( { selectedWpcomSite }: WpcomSiteAssistantProps ) {
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const userId = user?.id;
	const isOffline = useOffline();
	const { setSelectedWpcomSite, setWpcomSiteActivity, wpcomSites = [] } = useSiteDetails();
	const [ createWpcomStagingSite, createWpcomStagingSiteResult ] =
		useCreateWpcomStagingSiteMutation();
	const sessionCacheKey = createWpcomSiteAssistantSessionKey( selectedWpcomSite.id );
	const initialSessionState = getWpcomSiteAssistantSessionState(
		sessionCacheKey,
		selectedWpcomSite
	);
	const [ selectedConversationId, setSelectedConversationId ] = useState( initialSessionState.id );
	const [ _conversationListVersion, setConversationListVersion ] = useState( 0 );
	const [ input, setInput ] = useState( initialSessionState.input );
	const [ messages, setMessages ] = useState< MessageType[] >( initialSessionState.messages );
	const [ sessionId, setSessionId ] = useState< string | undefined >(
		initialSessionState.sessionId
	);
	const [ isAssistantThinking, setIsAssistantThinking ] = useState( false );
	const [ activeWpcomSite, setActiveWpcomSite ] = useState< SyncSite >(
		initialSessionState.activeWpcomSite
	);
	const [ previewState, setPreviewState ] = useState< DollyPreviewState >(
		initialSessionState.previewState
	);
	const [ pendingImages, setPendingImages ] = useState< DollyPendingImage[] >( [] );
	const [ imageUploadError, setImageUploadError ] = useState< string | undefined >();
	const [ stagingCreationSiteId, setStagingCreationSiteId ] = useState< number | undefined >();
	const [ showJumpToLatest, setShowJumpToLatest ] = useState( false );
	const [ chatMenuAnchor, setChatMenuAnchor ] = useState< Element | null >( null );
	const [ optimisticMessageImages, setOptimisticMessageImages ] = useState<
		Record< string, DollyMessageImageAttachment >
	>( {} );
	const isMountedRef = useRef( true );
	const imageUploaderRef = useRef< ImageUploaderHandle >( null );
	const dollyDropZoneRef = useRef< HTMLDivElement >( null );
	const conversationViewRef = useRef< HTMLDivElement >( null );
	const messagesRef = useRef< MessageType[] >( messages );
	const pendingImagesRef = useRef< DollyPendingImage[] >( pendingImages );
	const activeWpcomSiteRef = useRef< SyncSite >( activeWpcomSite );
	const previewStateRef = useRef< DollyPreviewState >( previewState );
	const selectedWpcomSiteIdRef = useRef( selectedWpcomSite.id );
	const conversationIdRef = useRef( selectedConversationId );
	const remoteChatIdRef = useRef( initialSessionState.remoteChatId );
	const serverHydrationDisabledRef = useRef(
		Boolean( initialSessionState.serverHydrationDisabled )
	);
	const preserveLastUpdatedOnNextWriteRef = useRef( false );
	const isAssistantThinkingRef = useRef( isAssistantThinking );
	const hydratedSessionKeysRef = useRef( new Set< string >() );
	const wpcomSiteWorkspace = useMemo(
		() => getWpcomSiteWorkspaceForSite( wpcomSites, activeWpcomSite ),
		[ activeWpcomSite, wpcomSites ]
	);
	const conversationsForTarget = getWpcomSiteAssistantConversationsForSite( activeWpcomSite.id );
	const selectedConversationForTarget =
		conversationsForTarget.find( ( conversation ) => conversation.id === selectedConversationId ) ??
		conversationsForTarget[ 0 ];
	const showConversationControls = shouldShowConversationControls(
		conversationsForTarget,
		selectedConversationForTarget
	);
	const previewUrl = useMemo(
		() => normalizePreviewUrl( activeWpcomSite.url, previewState.pathOrUrl ),
		[ activeWpcomSite.url, previewState.pathOrUrl ]
	);
	const previewDisplayUrl = previewState.currentUrl || previewUrl || activeWpcomSite.url;
	const previewHeaderDisplayUrl = previewState.open
		? previewDisplayUrl
		: previewState.currentUrl || activeWpcomSite.url;
	const siteAssociation = useMemo(
		() => createWpcomOnlySiteAssociationContext( activeWpcomSite ),
		[ activeWpcomSite ]
	);
	const previewContext = useMemo(
		() => createPreviewContext( activeWpcomSite, previewState, previewUrl ),
		[ activeWpcomSite, previewState, previewUrl ]
	);
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const failedMessageContent = messages.find( ( msg ) => msg.failedMessage )?.content;
	const productionTargetSite =
		wpcomSiteWorkspace?.productionSite ??
		( activeWpcomSite.isStaging ? undefined : activeWpcomSite );
	const stagingTargetSite =
		wpcomSiteWorkspace?.stagingSites[ 0 ] ??
		( activeWpcomSite.isStaging ? activeWpcomSite : undefined );
	const stagingCreationBlocker = productionTargetSite
		? getKnownStagingCreationBlocker( productionTargetSite )
		: __( 'Production site details are not available yet.' );
	const canCreateStagingSite =
		Boolean( productionTargetSite ) &&
		! stagingTargetSite &&
		! productionTargetSite?.isStaging &&
		! productionTargetSite?.isPressable &&
		! productionTargetSite?.stagingSiteIds?.length &&
		! stagingCreationBlocker;
	const isCreatingStagingSite = createWpcomStagingSiteResult.isLoading;
	const isCreatingStagingSiteForTarget =
		isCreatingStagingSite && stagingCreationSiteId === productionTargetSite?.id;
	const hasActiveAssistantTurn = useWpcomSiteAssistantTurn( selectedConversationId );
	const isCurrentSessionAssistantThinking = isAssistantThinking || hasActiveAssistantTurn;
	const hadActiveAssistantTurnRef = useRef( hasActiveAssistantTurn );
	const locallyStartedTurnConversationIdsRef = useRef( new Set< string >() );
	const stagingCreationSiteIdRef = useRef< number | undefined >( undefined );
	const isAtLatestMessageRef = useRef( true );
	const previousMessageCountRef = useRef( messages.length );

	const refreshConversationList = useCallback( () => {
		setConversationListVersion( ( version ) => version + 1 );
	}, [] );

	const updatePreviewState = useCallback( ( nextState: Partial< DollyPreviewState > ) => {
		setPreviewState( ( currentState ) => {
			const nextPreviewState = { ...currentState, ...nextState };
			setWpcomSiteAssistantTargetPreviewState( activeWpcomSiteRef.current.id, nextPreviewState );
			return nextPreviewState;
		} );
	}, [] );

	const clearPendingImages = useCallback( () => {
		setPendingImages( ( currentImages ) => {
			revokeDollyPendingImageUrls( currentImages );
			return [];
		} );
		setImageUploadError( undefined );
	}, [] );

	const removePendingImage = useCallback( ( image: UploadedImage ) => {
		setPendingImages( ( currentImages ) => {
			const removedImage = currentImages.find( ( currentImage ) => currentImage.id === image.id );
			if ( removedImage ) {
				revokeDollyPendingImageUrls( [ removedImage ] );
			}
			return currentImages.filter( ( currentImage ) => currentImage.id !== image.id );
		} );
	}, [] );

	const addPendingImages = useCallback(
		( files: File[] ) => {
			const validFiles = files.filter( ( file ) => DOLLY_IMAGE_FILE_TYPES.includes( file.type ) );
			const validSizedFiles = validFiles.filter(
				( file ) => file.size <= DOLLY_IMAGE_MAX_FILE_SIZE
			);
			const remainingSlots = Math.max( DOLLY_IMAGE_MAX_FILES - pendingImages.length, 0 );
			const filesToAdd = validSizedFiles.slice( 0, remainingSlots );

			if ( files.length !== validFiles.length ) {
				setImageUploadError( __( 'Only JPEG, PNG, GIF, or WebP images can be attached.' ) );
			} else if ( validFiles.length !== validSizedFiles.length ) {
				setImageUploadError( __( 'Images must be 10 MB or smaller.' ) );
			} else if ( validSizedFiles.length > filesToAdd.length ) {
				setImageUploadError(
					sprintf( __( 'You can attach up to %d images at a time.' ), DOLLY_IMAGE_MAX_FILES )
				);
			} else if ( filesToAdd.length > 0 ) {
				setImageUploadError( undefined );
			}

			if ( filesToAdd.length === 0 ) {
				return;
			}

			const nextImages = filesToAdd.map( ( file ) => ( {
				id: crypto.randomUUID(),
				url: URL.createObjectURL( file ),
				name: file.name,
				title: file.name,
				mime_type: file.type,
				file,
			} ) );

			setPendingImages( ( currentImages ) => [ ...currentImages, ...nextImages ] );

			void Promise.all(
				nextImages.map( async ( image ) => ( {
					sourceId: image.id,
					dataUrl: await readFileAsDataUrl( image.file ),
				} ) )
			)
				.then( ( imageDataUrls ) => {
					if ( ! isMountedRef.current ) {
						return;
					}
					const dataUrlsByImageId = new Map< string, string >(
						imageDataUrls.map( ( image ) => [ image.sourceId, image.dataUrl ] )
					);
					setPendingImages( ( currentImages ) =>
						currentImages.map( ( currentImage ) => ( {
							...currentImage,
							dataUrl: dataUrlsByImageId.get( currentImage.id ) ?? currentImage.dataUrl,
						} ) )
					);
				} )
				.catch( () => {
					if ( isMountedRef.current ) {
						setImageUploadError( __( 'Unable to prepare image preview.' ) );
					}
				} );
		},
		[ pendingImages.length ]
	);

	useEffect( () => {
		activeWpcomSiteRef.current = activeWpcomSite;
	}, [ activeWpcomSite ] );

	useEffect( () => {
		previewStateRef.current = previewState;
	}, [ previewState ] );

	useEffect( () => {
		pendingImagesRef.current = pendingImages;
	}, [ pendingImages ] );

	useEffect( () => {
		messagesRef.current = messages;
	}, [ messages ] );

	useEffect( () => () => revokeDollyPendingImageUrls( pendingImagesRef.current ), [] );

	useEffect( () => {
		isAssistantThinkingRef.current = isCurrentSessionAssistantThinking;
	}, [ isCurrentSessionAssistantThinking ] );

	useEffect( () => {
		setWpcomSiteActivity( selectedWpcomSite.id, {
			hasUnreadAssistantMessage: false,
		} );
	}, [ selectedWpcomSite.id, setWpcomSiteActivity ] );

	const getMessagesScrollArea = useCallback(
		() =>
			conversationViewRef.current?.querySelector< HTMLElement >( '[data-slot="messages"]' ) ?? null,
		[]
	);

	const isMessagesScrollAreaAtLatest = useCallback( () => {
		const scrollArea = getMessagesScrollArea();
		if ( ! scrollArea ) {
			return true;
		}

		return scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight <= 48;
	}, [ getMessagesScrollArea ] );

	const scrollToLatestMessage = useCallback(
		( behavior: ScrollBehavior = 'smooth' ) => {
			const scrollArea = getMessagesScrollArea();
			if ( ! scrollArea ) {
				return;
			}

			if ( behavior === 'auto' ) {
				scrollArea.scrollTop = scrollArea.scrollHeight;
			} else {
				scrollArea.scrollTo( {
					top: scrollArea.scrollHeight,
					behavior,
				} );
			}

			isAtLatestMessageRef.current = true;
			setShowJumpToLatest( false );
		},
		[ getMessagesScrollArea ]
	);

	useEffect( () => {
		if ( selectedWpcomSiteIdRef.current !== selectedWpcomSite.id ) {
			return;
		}

		const cachedSessionState = wpcomSiteAssistantSessionStateCache.get( conversationIdRef.current );
		const preserveLastUpdated = preserveLastUpdatedOnNextWriteRef.current;
		preserveLastUpdatedOnNextWriteRef.current = false;

		const sessionState: WpcomSiteAssistantSessionState = {
			id: conversationIdRef.current,
			key: {
				siteId: selectedWpcomSite.id,
				agentId: DOLLY_AGENT_ID,
			},
			remoteChatId: remoteChatIdRef.current,
			serverHydrationDisabled: serverHydrationDisabledRef.current,
			input,
			messages,
			sessionId,
			activeWpcomSite,
			previewState,
			lastUpdated:
				preserveLastUpdated && cachedSessionState ? cachedSessionState.lastUpdated : Date.now(),
		};
		wpcomSiteAssistantSessionStateCache.set( sessionState.id, sessionState );
		setSelectedWpcomSiteAssistantConversationId( selectedWpcomSite.id, sessionState.id );
		setWpcomSiteAssistantTargetPreviewState( activeWpcomSite.id, previewState );
		persistWpcomSiteAssistantSessionStateCache();
		refreshConversationList();
	}, [
		activeWpcomSite,
		input,
		messages,
		previewState,
		refreshConversationList,
		selectedWpcomSite.id,
		sessionId,
	] );

	useEffect( () => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, [] );

	useEffect( () => {
		if ( selectedWpcomSiteIdRef.current === selectedWpcomSite.id ) {
			return;
		}

		const shouldKeepPreviewOpen = previewStateRef.current.open;
		selectedWpcomSiteIdRef.current = selectedWpcomSite.id;
		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		const targetPreviewState = getWpcomSiteAssistantTargetPreviewState( selectedWpcomSite );
		const nextPreviewState =
			shouldKeepPreviewOpen && ! targetPreviewState.open
				? {
						...targetPreviewState,
						open: true,
						pathOrUrl: targetPreviewState.pathOrUrl || '/',
				  }
				: targetPreviewState;
		if ( shouldKeepPreviewOpen && ! targetPreviewState.open ) {
			setWpcomSiteAssistantTargetPreviewState( selectedWpcomSite.id, nextPreviewState );
		}
		conversationIdRef.current = nextSessionState.id;
		setSelectedConversationId( nextSessionState.id );
		remoteChatIdRef.current = nextSessionState.remoteChatId;
		serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
		activeWpcomSiteRef.current = nextSessionState.activeWpcomSite;
		messagesRef.current = nextSessionState.messages;
		setActiveWpcomSite( nextSessionState.activeWpcomSite );
		setInput( nextSessionState.input );
		setMessages( nextSessionState.messages );
		setOptimisticMessageImages( {} );
		setSessionId( nextSessionState.sessionId );
		setIsAssistantThinking( Boolean( getWpcomSiteAssistantTurn( nextSessionState.id ) ) );
		setPreviewState( nextPreviewState );
		refreshConversationList();
	}, [ refreshConversationList, selectedWpcomSite, sessionCacheKey ] );

	useEffect( () => {
		if ( ! showConversationControls ) {
			setChatMenuAnchor( null );
		}
	}, [ showConversationControls ] );

	useEffect( () => {
		previousMessageCountRef.current = messagesRef.current.length;
		isAtLatestMessageRef.current = true;
		setShowJumpToLatest( false );

		const animationFrameId = window.requestAnimationFrame( () => {
			scrollToLatestMessage( 'auto' );
		} );

		return () => {
			window.cancelAnimationFrame( animationFrameId );
		};
	}, [ scrollToLatestMessage, selectedConversationId ] );

	useEffect( () => {
		const previousMessageCount = previousMessageCountRef.current;
		const latestMessage = messages[ messages.length - 1 ];
		previousMessageCountRef.current = messages.length;

		if ( messages.length <= previousMessageCount || latestMessage?.role !== 'assistant' ) {
			return;
		}

		if ( isAtLatestMessageRef.current ) {
			const animationFrameId = window.requestAnimationFrame( () => {
				scrollToLatestMessage( 'smooth' );
			} );

			return () => {
				window.cancelAnimationFrame( animationFrameId );
			};
		}

		setShowJumpToLatest( true );
	}, [ messages, scrollToLatestMessage ] );

	useEffect( () => {
		if (
			! isAuthenticated ||
			isOffline ||
			! client ||
			typeof ( client.req as { get?: unknown } ).get !== 'function' ||
			hydratedSessionKeysRef.current.has( sessionCacheKey )
		) {
			return;
		}

		hydratedSessionKeysRef.current.add( sessionCacheKey );
		let isCurrentHydration = true;

		void ( async () => {
			try {
				const cachedSessionState = getWpcomSiteAssistantSessionState(
					sessionCacheKey,
					selectedWpcomSite
				);
				const hydratedSessionStates = await hydrateWpcomSiteAssistantConversationStates(
					client,
					selectedWpcomSite,
					cachedSessionState.sessionId
				);

				if (
					hydratedSessionStates.length === 0 ||
					! isCurrentHydration ||
					! isMountedRef.current ||
					isAssistantThinkingRef.current
				) {
					return;
				}

				hydratedSessionStates.forEach( ( hydratedSessionState ) => {
					mergeWpcomSiteAssistantConversationState( {
						...hydratedSessionState,
						serverHydrationDisabled: false,
						previewState: getWpcomSiteAssistantTargetPreviewState( selectedWpcomSite ),
					} );
				} );
				refreshConversationList();

				const nextSessionState = getWpcomSiteAssistantSessionState(
					sessionCacheKey,
					selectedWpcomSite
				);

				conversationIdRef.current = nextSessionState.id;
				setSelectedConversationId( nextSessionState.id );
				remoteChatIdRef.current = nextSessionState.remoteChatId;
				serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
				setActiveWpcomSite( nextSessionState.activeWpcomSite );
				setInput( nextSessionState.input );
				setMessages( nextSessionState.messages );
				setOptimisticMessageImages( {} );
				setSessionId( nextSessionState.sessionId );
			} catch ( error ) {
				console.error( error );
			}
		} )();

		return () => {
			isCurrentHydration = false;
		};
	}, [
		client,
		isAuthenticated,
		isOffline,
		refreshConversationList,
		selectedWpcomSite,
		sessionCacheKey,
	] );

	const openPreview = useCallback(
		( pathOrUrl = '/', title?: string, { forceReload = false }: OpenPreviewOptions = {} ) => {
			updatePreviewState(
				getNextPreviewState( previewStateRef.current, pathOrUrl, title, { forceReload } )
			);
		},
		[ updatePreviewState ]
	);

	const navigatePreviewHistory = useCallback(
		( navigationAction: NonNullable< DollyPreviewState[ 'navigationAction' ] > ) => {
			updatePreviewState( {
				navigationAction,
				navigationNonce: ( previewStateRef.current.navigationNonce ?? 0 ) + 1,
			} );
		},
		[ updatePreviewState ]
	);

	const openChatLinkInPreview = useCallback(
		( rawHref?: string, title?: string ) => {
			const href = rawHref?.trim();
			if ( ! href || href === 'agenttic:incomplete-link' || href.startsWith( '#' ) ) {
				return false;
			}

			const hasNonHttpScheme = /^[a-z][a-z0-9+.-]*:/i.test( href ) && ! /^https?:/i.test( href );
			if ( hasNonHttpScheme ) {
				return false;
			}

			const normalizedUrl = normalizePreviewUrl( activeWpcomSiteRef.current.url, href );
			if ( normalizedUrl === 'about:blank' ) {
				return false;
			}

			openPreview( normalizedUrl, title );
			return true;
		},
		[ openPreview ]
	);

	const dollyMessageRenderer = useMemo(
		() =>
			createMessageRenderer( {
				components: {
					a: ( { node, href, children, className, ...props } ) => (
						<a
							{ ...props }
							href={ href }
							className={ cx( className, 'cursor-pointer underline-offset-2 hover:underline' ) }
							onClick={ ( event ) => {
								if ( openChatLinkInPreview( href, event.currentTarget.textContent ?? undefined ) ) {
									event.preventDefault();
									event.stopPropagation();
								}
							} }
						>
							{ children }
						</a>
					),
				},
			} ),
		[ openChatLinkInPreview ]
	);

	const isVisibleSession = useCallback( ( targetConversationId: string ) => {
		return isMountedRef.current && conversationIdRef.current === targetConversationId;
	}, [] );

	const writeCachedSessionState = useCallback(
		(
			targetConversationId: string,
			targetSelectedWpcomSite: SyncSite,
			updater: (
				currentSessionState: WpcomSiteAssistantSessionState
			) => WpcomSiteAssistantSessionState
		) => {
			const currentSessionState = wpcomSiteAssistantSessionStateCache.get(
				targetConversationId
			) ?? {
				...createWpcomSiteAssistantSessionState( targetSelectedWpcomSite ),
				id: targetConversationId,
			};
			const nextSessionState = {
				...updater( currentSessionState ),
				id: targetConversationId,
				lastUpdated: Date.now(),
			};
			wpcomSiteAssistantSessionStateCache.set( targetConversationId, nextSessionState );
			persistWpcomSiteAssistantSessionStateCache();
			refreshConversationList();
			return nextSessionState;
		},
		[ refreshConversationList ]
	);

	const applyVisibleSessionState = useCallback(
		(
			targetConversationId: string,
			nextSessionState: WpcomSiteAssistantSessionState,
			{ clearOptimisticImages = false }: { clearOptimisticImages?: boolean } = {}
		) => {
			if ( ! isVisibleSession( targetConversationId ) ) {
				return;
			}

			conversationIdRef.current = nextSessionState.id;
			setSelectedConversationId( nextSessionState.id );
			remoteChatIdRef.current = nextSessionState.remoteChatId;
			serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
			messagesRef.current = nextSessionState.messages;
			setActiveWpcomSite( nextSessionState.activeWpcomSite );
			setInput( nextSessionState.input );
			setMessages( nextSessionState.messages );
			setSessionId( nextSessionState.sessionId );
			if ( clearOptimisticImages ) {
				setOptimisticMessageImages( {} );
			}
		},
		[ isVisibleSession ]
	);

	useEffect( () => {
		const hadActiveAssistantTurn = hadActiveAssistantTurnRef.current;
		hadActiveAssistantTurnRef.current = hasActiveAssistantTurn;

		if ( ! hadActiveAssistantTurn || hasActiveAssistantTurn || isAssistantThinking ) {
			return;
		}

		if ( locallyStartedTurnConversationIdsRef.current.delete( selectedConversationId ) ) {
			return;
		}

		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		applyVisibleSessionState( nextSessionState.id, nextSessionState );
		setIsAssistantThinking( false );
	}, [
		applyVisibleSessionState,
		hasActiveAssistantTurn,
		isAssistantThinking,
		selectedWpcomSite,
		selectedConversationId,
		sessionCacheKey,
	] );

	useEffect( () => {
		const scrollArea = getMessagesScrollArea();
		if ( ! scrollArea ) {
			return;
		}

		const handleScroll = () => {
			const isAtLatest = isMessagesScrollAreaAtLatest();
			isAtLatestMessageRef.current = isAtLatest;
			if ( isAtLatest ) {
				setShowJumpToLatest( false );
			}
		};

		scrollArea.addEventListener( 'scroll', handleScroll, { passive: true } );
		handleScroll();

		return () => {
			scrollArea.removeEventListener( 'scroll', handleScroll );
		};
	}, [ getMessagesScrollArea, isMessagesScrollAreaAtLatest, selectedConversationId ] );

	const selectTargetSite = useCallback(
		( site: SyncSite ) => {
			const workspace = getWpcomSiteWorkspaceForSite( wpcomSites, site );
			if ( workspace ) {
				setSavedWpcomWorkspaceTarget( workspace.id, site.id );
			}
			setSelectedWpcomSite( site );
		},
		[ setSelectedWpcomSite, wpcomSites ]
	);

	const createStagingSiteForSite = useCallback(
		async ( site: SyncSite, { selectWpcomSite = false }: { selectWpcomSite?: boolean } = {} ) => {
			const blocker = getKnownStagingCreationBlocker( site );
			const canCreate =
				! site.isStaging && ! site.isPressable && ! site.stagingSiteIds?.length && ! blocker;

			if ( ! canCreate ) {
				throw new Error( getCreateStagingSiteUnavailableMessage( site ) );
			}

			stagingCreationSiteIdRef.current = site.id;
			if ( isMountedRef.current ) {
				setStagingCreationSiteId( site.id );
			}
			setWpcomSiteActivity( site.id, {
				isCreatingStagingSite: true,
			} );

			try {
				const stagingSite = await createWpcomStagingSite( {
					site,
					userId,
				} ).unwrap();

				if ( isMountedRef.current && activeWpcomSiteRef.current.id === site.id ) {
					setActiveWpcomSite( stagingSite );
					if ( selectWpcomSite && selectedWpcomSiteIdRef.current === site.id ) {
						selectTargetSite( stagingSite );
					}
				}

				return stagingSite;
			} finally {
				setWpcomSiteActivity( site.id, {
					isCreatingStagingSite: false,
				} );

				if ( stagingCreationSiteIdRef.current === site.id ) {
					stagingCreationSiteIdRef.current = undefined;
					if ( isMountedRef.current ) {
						setStagingCreationSiteId( undefined );
					}
				}
			}
		},
		[ createWpcomStagingSite, selectTargetSite, setWpcomSiteActivity, userId ]
	);

	const createDollyToolProviderForSession = useCallback(
		( {
			targetSessionKey,
			targetSelectedWpcomSite,
			targetActiveWpcomSite,
			targetPreviewState,
		}: {
			targetSessionKey: string;
			targetSelectedWpcomSite: SyncSite;
			targetActiveWpcomSite: SyncSite;
			targetPreviewState: DollyPreviewState;
		} ): ToolProvider => ( {
			getAbilities: async () => [
				...createDollyPreviewAbilities( {
					activeWpcomSite: targetActiveWpcomSite,
					previewState: targetPreviewState,
					openPreview: ( pathOrUrl = '/', title, options ) => {
						const nextPreviewState = getNextPreviewState(
							getWpcomSiteAssistantTargetPreviewState( targetActiveWpcomSite ),
							pathOrUrl,
							title,
							options
						);
						setWpcomSiteAssistantTargetPreviewState( targetActiveWpcomSite.id, nextPreviewState );

						if ( selectedWpcomSiteIdRef.current === targetActiveWpcomSite.id ) {
							setPreviewState( nextPreviewState );
						}
					},
				} ),
				createDollyManageStagingSiteAbility( async ( input: Record< string, unknown > ) => {
					const action = typeof input.action === 'string' ? input.action : 'create';
					const site = targetActiveWpcomSite;

					if ( action !== 'create' ) {
						return {
							success: false,
							action,
							siteId: site.id,
							error: __( 'Studio only supports creating staging sites right now.' ),
						};
					}

					try {
						const stagingSite = await createStagingSiteForSite( site, {
							selectWpcomSite: true,
						} );
						const nextSessionState = writeCachedSessionState(
							targetSessionKey,
							targetSelectedWpcomSite,
							( currentSessionState ) => ( {
								...currentSessionState,
								activeWpcomSite: stagingSite,
							} )
						);
						applyVisibleSessionState( targetSessionKey, nextSessionState );
						return {
							success: true,
							action,
							siteId: site.id,
							stagingSiteId: stagingSite.id,
							url: stagingSite.url,
							message: sprintf( __( 'Created staging site: %s' ), stagingSite.url ),
						};
					} catch ( error ) {
						return {
							success: false,
							action,
							siteId: site.id,
							error: getStagingCreationErrorMessage( error, site ),
						};
					}
				} ),
			],
		} ),
		[ applyVisibleSessionState, createStagingSiteForSite, writeCachedSessionState ]
	);

	const syncBackendActiveWpcomSite = useCallback(
		async ( {
			backendSelectedSiteId,
			targetSessionKey,
			targetSelectedWpcomSite,
			targetActiveWpcomSite,
		}: {
			backendSelectedSiteId: number | undefined;
			targetSessionKey: string;
			targetSelectedWpcomSite: SyncSite;
			targetActiveWpcomSite: SyncSite;
		} ) => {
			if (
				! client ||
				! backendSelectedSiteId ||
				targetActiveWpcomSite.id === backendSelectedSiteId
			) {
				return;
			}

			const nextSite = await fetchDollySite( client, backendSelectedSiteId );
			if ( nextSite ) {
				const nextSessionState = writeCachedSessionState(
					targetSessionKey,
					targetSelectedWpcomSite,
					( currentSessionState ) => ( {
						...currentSessionState,
						activeWpcomSite: nextSite,
					} )
				);
				applyVisibleSessionState( targetSessionKey, nextSessionState );
			}
		},
		[ applyVisibleSessionState, client, writeCachedSessionState ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			const imagesToSend = isRetry ? [] : pendingImages;
			const targetSessionKey = selectedConversationId;
			if (
				( ! trimmedMessage && imagesToSend.length === 0 ) ||
				! client ||
				isCurrentSessionAssistantThinking ||
				selectedWpcomSiteIdRef.current !== selectedWpcomSite.id ||
				getWpcomSiteAssistantTurn( targetSessionKey )
			) {
				return;
			}

			if ( ! isRetry ) {
				setInput( '' );
			}

			const targetSelectedWpcomSite = selectedWpcomSite;
			const targetActiveWpcomSite = activeWpcomSite;
			const targetPreviewState = previewState;
			const targetPreviewContext = previewContext;
			const targetSiteAssociation = siteAssociation;
			const targetSessionId = sessionId;
			const targetConversationId = conversationIdRef.current;
			const targetRemoteChatId = remoteChatIdRef.current;
			const targetServerHydrationDisabled = serverHydrationDisabledRef.current;
			const startingMessages: MessageType[] = messagesRef.current.map( ( currentMessage ) => ( {
				...currentMessage,
				failedMessage: false,
			} ) );
			const messageToSend =
				trimmedMessage ||
				( imagesToSend.length > 0 ? createDollyImagePrompt( imagesToSend.length ) : '' );
			const newMessageId = isRetry ? startingMessages.length - 1 : startingMessages.length;
			const optimisticImagesPromise = createDollyPendingVisibleImages( imagesToSend );
			const abortController = new AbortController();
			const toolProvider = createDollyToolProviderForSession( {
				targetSessionKey,
				targetSelectedWpcomSite,
				targetActiveWpcomSite,
				targetPreviewState,
			} );

			if ( ! isRetry && imagesToSend.length > 0 ) {
				setPendingImages( [] );
				setImageUploadError( undefined );
				revokeDollyPendingImageUrls( imagesToSend );
			}

			startWpcomSiteAssistantTurn( {
				sessionKey: targetSessionKey,
				siteId: targetActiveWpcomSite.id,
				abortController,
			} );
			locallyStartedTurnConversationIdsRef.current.add( targetSessionKey );
			setWpcomSiteActivity( targetActiveWpcomSite.id, {
				isAssistantThinking: true,
			} );
			if ( isVisibleSession( targetSessionKey ) ) {
				setIsAssistantThinking( true );
			}

			void ( async () => {
				let optimisticMessage: MessageType | undefined;
				let messagesForResponse: MessageType[] = startingMessages;
				let uploadedImages: DollyUploadedImage[] = [];
				try {
					const optimisticImages = await optimisticImagesPromise;
					const nextOptimisticMessage = generateMessage( messageToSend, 'user', newMessageId );
					optimisticMessage = nextOptimisticMessage;
					if ( optimisticImages.length > 0 && isVisibleSession( targetSessionKey ) ) {
						setOptimisticMessageImages( ( currentImages ) => ( {
							...currentImages,
							[ nextOptimisticMessage.id ?? nextOptimisticMessage.createdAt ]: {
								text: messageToSend,
								images: optimisticImages,
							},
						} ) );
					}
					messagesForResponse = isRetry
						? startingMessages.map( ( currentMessage ) =>
								currentMessage.id === nextOptimisticMessage.id
									? { ...nextOptimisticMessage, failedMessage: false }
									: currentMessage
						  )
						: [ ...startingMessages, nextOptimisticMessage ];
					const sessionStateWithUserMessage = writeCachedSessionState(
						targetSessionKey,
						targetSelectedWpcomSite,
						( currentSessionState ) => ( {
							...currentSessionState,
							id: targetConversationId,
							remoteChatId: targetRemoteChatId,
							serverHydrationDisabled: targetServerHydrationDisabled,
							input: '',
							messages: messagesForResponse,
							sessionId: targetSessionId,
							activeWpcomSite: targetActiveWpcomSite,
							previewState: targetPreviewState,
						} )
					);
					applyVisibleSessionState( targetSessionKey, sessionStateWithUserMessage );

					uploadedImages = await uploadDollyImages(
						targetActiveWpcomSite.id,
						imagesToSend,
						abortController.signal
					);
					if ( uploadedImages.length > 0 ) {
						const uploadedVisibleImages = uploadedImages.map( ( image ) => ( {
							name: image.name,
							url: image.url,
						} ) );
						const visibleMessage = createDollyVisibleMessage(
							messageToSend,
							uploadedVisibleImages,
							imagesToSend.length
						);
						messagesForResponse = messagesForResponse.map( ( currentMessage ) =>
							currentMessage.id === optimisticMessage?.id
								? { ...currentMessage, content: visibleMessage }
								: currentMessage
						);
						const sessionStateWithUploadedImages = writeCachedSessionState(
							targetSessionKey,
							targetSelectedWpcomSite,
							( currentSessionState ) => ( {
								...currentSessionState,
								messages: messagesForResponse,
							} )
						);
						applyVisibleSessionState( targetSessionKey, sessionStateWithUploadedImages );
						void preloadDollyImageUrls( uploadedVisibleImages ).then( () => {
							if ( ! isVisibleSession( targetSessionKey ) ) {
								return;
							}

							setOptimisticMessageImages( ( currentImages ) => {
								const optimisticMessageKey = String(
									optimisticMessage?.id ?? optimisticMessage?.createdAt ?? ''
								);
								if ( ! currentImages[ optimisticMessageKey ] ) {
									return currentImages;
								}

								return {
									...currentImages,
									[ optimisticMessageKey ]: {
										text: messageToSend,
										images: uploadedVisibleImages,
									},
								};
							} );
						} );
					}

					const response = await sendDollyMessage( {
						abortSignal: abortController.signal,
						message: messageToSend,
						uploadedImages,
						previewContext: targetPreviewContext,
						siteAssociation: targetSiteAssociation,
						selectedSite: targetActiveWpcomSite,
						sessionId: targetSessionId,
						siteId: targetActiveWpcomSite.id,
						toolProvider,
					} );

					const responseMessages: MessageType[] = [ ...messagesForResponse ];
					const hasAssistantReply = Boolean( response.text.trim() );
					if ( hasAssistantReply ) {
						responseMessages.push(
							generateMessage( response.text, 'assistant', responseMessages.length )
						);
					}

					const nextSessionState = writeCachedSessionState(
						targetSessionKey,
						targetSelectedWpcomSite,
						( currentSessionState ) => ( {
							...currentSessionState,
							messages: responseMessages,
							sessionId: response.sessionId ?? targetSessionId,
						} )
					);
					applyVisibleSessionState( targetSessionKey, nextSessionState );
					if ( hasAssistantReply ) {
						setWpcomSiteActivity( targetActiveWpcomSite.id, {
							hasUnreadAssistantMessage: ! isVisibleSession( targetSessionKey ),
						} );
					}

					void resolveBackendSelectedSiteId( client, response, targetSessionId ).then(
						( backendSelectedSiteId ) => {
							void syncBackendActiveWpcomSite( {
								backendSelectedSiteId,
								targetSessionKey,
								targetSelectedWpcomSite,
								targetActiveWpcomSite,
							} );
						}
					);
				} catch ( error ) {
					if ( isDollyRequestAbortError( error ) || abortController.signal.aborted ) {
						return;
					}
					console.error( error );
					const errorMessage = getErrorMessage( error );
					const nextMessages = optimisticMessage
						? messagesForResponse.map( ( currentMessage ) =>
								currentMessage.id === optimisticMessage?.id
									? { ...currentMessage, failedMessage: true }
									: currentMessage
						  )
						: messagesForResponse;
					const nextSessionState = writeCachedSessionState(
						targetSessionKey,
						targetSelectedWpcomSite,
						( currentSessionState ) => ( {
							...currentSessionState,
							input: isRetry ? currentSessionState.input : chatMessage,
							messages: nextMessages,
						} )
					);
					if ( isVisibleSession( targetSessionKey ) ) {
						setImageUploadError( errorMessage );
					}
					applyVisibleSessionState( targetSessionKey, nextSessionState );
				} finally {
					finishWpcomSiteAssistantTurn( targetSessionKey, abortController );
					setWpcomSiteActivity( targetActiveWpcomSite.id, {
						isAssistantThinking: false,
					} );
					if ( isVisibleSession( targetSessionKey ) ) {
						setIsAssistantThinking( false );
					}
				}
			} )();
		},
		[
			activeWpcomSite,
			applyVisibleSessionState,
			client,
			createDollyToolProviderForSession,
			isCurrentSessionAssistantThinking,
			isVisibleSession,
			pendingImages,
			previewContext,
			previewState,
			selectedConversationId,
			selectedWpcomSite,
			sessionId,
			siteAssociation,
			syncBackendActiveWpcomSite,
			setWpcomSiteActivity,
			writeCachedSessionState,
		]
	);

	const applySelectedConversationState = useCallback(
		( nextSessionState: WpcomSiteAssistantSessionState ) => {
			conversationIdRef.current = nextSessionState.id;
			setSelectedConversationId( nextSessionState.id );
			remoteChatIdRef.current = nextSessionState.remoteChatId;
			serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
			messagesRef.current = nextSessionState.messages;
			setInput( nextSessionState.input );
			setMessages( nextSessionState.messages );
			setOptimisticMessageImages( {} );
			setSessionId( nextSessionState.sessionId );
			setActiveWpcomSite( nextSessionState.activeWpcomSite );
			setIsAssistantThinking( Boolean( getWpcomSiteAssistantTurn( nextSessionState.id ) ) );
			clearPendingImages();
			refreshConversationList();
		},
		[ clearPendingImages, refreshConversationList ]
	);

	const startNewConversation = useCallback( () => {
		const nextSessionState = createNewWpcomSiteAssistantConversation( selectedWpcomSite );
		applySelectedConversationState( nextSessionState );
	}, [ applySelectedConversationState, selectedWpcomSite ] );

	const selectConversation = useCallback(
		( conversationId: string ) => {
			const nextSessionState = wpcomSiteAssistantSessionStateCache.get( conversationId );
			if ( ! nextSessionState || nextSessionState.key.siteId !== selectedWpcomSite.id ) {
				return;
			}

			preserveLastUpdatedOnNextWriteRef.current = true;
			setSelectedWpcomSiteAssistantConversationId( selectedWpcomSite.id, conversationId );
			applySelectedConversationState( nextSessionState );
		},
		[ applySelectedConversationState, selectedWpcomSite.id ]
	);

	const deleteConversation = useCallback(
		( conversationId: string ) => {
			if ( getWpcomSiteAssistantTurn( conversationId ) ) {
				return;
			}

			const nextSessionState = deleteWpcomSiteAssistantConversation(
				conversationId,
				selectedWpcomSite
			);
			applySelectedConversationState( nextSessionState );
		},
		[ applySelectedConversationState, selectedWpcomSite ]
	);

	const agentticMessages = useMemo< AgentUIProps[ 'messages' ] >(
		() =>
			messages.map( ( message ) => {
				const messageKey = String( message.id ?? message.createdAt );
				const optimisticImageAttachment = optimisticMessageImages[ messageKey ];

				return {
					id: `${ message.role }-${ message.id ?? message.createdAt }`,
					role: message.role === 'assistant' ? 'agent' : 'user',
					content: [
						{
							type: 'text',
							text: optimisticImageAttachment?.text ?? message.content,
						},
						...( optimisticImageAttachment?.images.length
							? [
									{
										type: 'component' as const,
										component: DollyOptimisticImages,
										componentProps: {
											images: optimisticImageAttachment.images,
										},
									},
							  ]
							: [] ),
					],
					timestamp: message.createdAt,
					archived: false,
					showIcon: message.role === 'assistant',
					disabled: Boolean( message.failedMessage ),
				};
			} ),
		[ messages, optimisticMessageImages ]
	);

	const retryFailedMessage = useCallback( () => {
		if ( failedMessageContent ) {
			submitPrompt( failedMessageContent, true );
		}
	}, [ failedMessageContent, submitPrompt ] );

	const interruptDollyRequest = useCallback( () => {
		abortWpcomSiteAssistantTurn( selectedConversationId );
	}, [ selectedConversationId ] );

	const createStagingSiteFromTargetSwitcher = useCallback( async () => {
		if ( ! canCreateStagingSite || isCreatingStagingSite || isAssistantThinkingRef.current ) {
			return;
		}

		const site = productionTargetSite;
		if ( ! site ) {
			return;
		}

		try {
			await createStagingSiteForSite( site, { selectWpcomSite: true } );
		} catch ( error ) {
			if ( ! isMountedRef.current ) {
				return;
			}

			getIpcApi().showErrorMessageBox( {
				title: __( 'Could not create staging site' ),
				message: getStagingCreationErrorMessage( error, site ),
			} );
		}
	}, [
		canCreateStagingSite,
		createStagingSiteForSite,
		isCreatingStagingSite,
		productionTargetSite,
	] );

	const dollyNotice = useMemo< AgentticNoticeConfig | undefined >( () => {
		if ( isOffline ) {
			return {
				icon: false,
				message: __( 'The AI assistant requires an internet connection.' ),
				status: 'warning',
				dismissible: false,
			};
		}

		if ( hasFailedMessage ) {
			return {
				message: __( "Oops! We couldn't get a response from Dolly." ),
				action: {
					label: __( 'Try again' ),
					onClick: retryFailedMessage,
				},
				status: 'error',
				dismissible: false,
			};
		}

		if ( imageUploadError ) {
			return {
				message: imageUploadError,
				status: 'error',
				dismissible: true,
				onDismiss: () => setImageUploadError( undefined ),
			};
		}

		return undefined;
	}, [ hasFailedMessage, imageUploadError, isOffline, retryFailedMessage ] );

	const isInputUnavailable = isOffline || ! isAuthenticated || ! client;
	const isInputDisabled = isInputUnavailable && ! isCurrentSessionAssistantThinking;
	const isInputActionDisabled = isInputUnavailable || isCurrentSessionAssistantThinking;
	const stagingTargetDisabledReason = stagingTargetSite
		? undefined
		: isCurrentSessionAssistantThinking
		? __( 'Wait for Dolly to finish before creating a staging site.' )
		: isCreatingStagingSiteForTarget
		? __( 'Creating staging site...' )
		: isOffline
		? __( 'Connect to the internet to create a staging site.' )
		: ! isAuthenticated || ! client
		? __( 'Log in to WordPress.com to create a staging site.' )
		: stagingCreationBlocker;
	const canUseStagingTarget =
		Boolean( stagingTargetSite ) ||
		( canCreateStagingSite &&
			! isCreatingStagingSite &&
			! isCurrentSessionAssistantThinking &&
			! isOffline &&
			isAuthenticated &&
			Boolean( client ) );

	const dollyInputActions = useMemo( () => {
		return [
			{
				id: 'upload-image',
				icon: <Icon icon={ imageIcon } size={ 18 } />,
				onClick: () => imageUploaderRef.current?.openFileDialog(),
				variant: 'ghost' as const,
				disabled: isInputActionDisabled,
				'aria-label': __( 'Upload image' ),
			},
			...( showConversationControls
				? [
						{
							id: 'chat-options',
							icon: <Icon icon={ moreVertical } size={ 18 } />,
							onClick: ( event?: React.MouseEvent< HTMLButtonElement > ) => {
								const nextAnchor = event?.currentTarget ?? null;
								setChatMenuAnchor( ( currentAnchor ) =>
									currentAnchor === nextAnchor ? null : nextAnchor
								);
							},
							variant: 'ghost' as const,
							disabled: false,
							'aria-label': __( 'Chat options' ),
						},
				  ]
				: [] ),
		];
	}, [ isInputActionDisabled, showConversationControls ] );

	const dollyEmptyView = useMemo( () => <div className="h-full" aria-hidden="true" />, [] );

	return (
		<div className="app-no-drag-region relative flex h-full min-h-0 min-w-0 flex-1 select-text overflow-hidden bg-frame-surface">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="shrink-0 border-b border-a8c-gray-5 bg-white px-8 py-4">
					<div className="grid min-w-0 gap-2">
						<h1 className="m-0 truncate text-xl font-semibold text-frame-text">
							{ activeWpcomSite.name }
						</h1>
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(14rem,27rem)] items-center gap-4">
							<WpcomTargetSwitcher
								workspace={ wpcomSiteWorkspace }
								selectedSite={ activeWpcomSite }
								onSelectSite={ selectTargetSite }
								onCreateStagingSite={ () => void createStagingSiteFromTargetSwitcher() }
								canCreateStagingSite={ canUseStagingTarget }
								isCreatingStagingSite={ isCreatingStagingSiteForTarget }
								stagingDisabledReason={ stagingTargetDisabledReason }
							/>
							<div className="flex min-w-0 justify-end">
								<DollyPreviewHeaderControls
									isOpen={ previewState.open }
									displayUrl={ previewHeaderDisplayUrl }
									previewUrl={ previewUrl }
									canGoBack={ previewState.canGoBack }
									canGoForward={ previewState.canGoForward }
									onOpen={ () => openPreview( previewState.pathOrUrl ) }
									onClose={ () => updatePreviewState( { open: false } ) }
									onGoBack={ () => navigatePreviewHistory( 'back' ) }
									onGoForward={ () => navigatePreviewHistory( 'forward' ) }
									onRefresh={ () =>
										updatePreviewState( {
											isLoading: true,
											reloadNonce: previewState.reloadNonce + 1,
										} )
									}
								/>
							</div>
						</div>
					</div>
				</div>
				<div className="flex min-h-0 flex-1">
					<div
						data-testid="assistant-chat"
						ref={ dollyDropZoneRef }
						className={ cx( 'min-h-0 flex-1', ! isAuthenticated && 'overflow-y-auto p-8 pb-2' ) }
					>
						{ isAuthenticated ? (
							<div className="agenttic dolly-agenttic-chat h-full min-h-0 overflow-hidden">
								<AgentUI.Container
									messages={ agentticMessages }
									isProcessing={ isCurrentSessionAssistantThinking }
									error={ null }
									onSubmit={ submitPrompt }
									onStop={ interruptDollyRequest }
									variant="embedded"
									placeholder={ __( 'Ask Dolly about this site' ) }
									notice={ dollyNotice }
									emptyView={ dollyEmptyView }
									messageRenderer={ dollyMessageRenderer }
									messagesPosition="bottom"
									inputValue={ input }
									onInputChange={ setInput }
									maxInputLength={ 10000 }
									thinkingMessage={ __( 'Thinking...' ) }
									className="h-full min-h-0 bg-frame-surface"
								>
									<AgentUI.ConversationView
										ref={ conversationViewRef }
										showHeader={ false }
										className="relative min-h-0 overflow-hidden px-6 pb-4 pt-6"
									>
										<AgentUI.Messages key={ selectedConversationId } />
										{ showJumpToLatest && (
											<div className="pointer-events-none absolute inset-x-0 bottom-28 z-20 flex justify-center">
												<button
													type="button"
													aria-label={ __( 'Jump to latest message' ) }
													onClick={ () => scrollToLatestMessage( 'smooth' ) }
													className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full border border-a8c-gray-5 bg-white text-frame-text-secondary shadow-sm transition hover:text-frame-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
												>
													<Icon icon={ chevronDown } size={ 20 } />
												</button>
											</div>
										) }
										<AgentUI.Footer className="mx-2 shrink-0 bg-white">
											<AgentUI.Notice />
											<ImageUploader
												ref={ imageUploaderRef }
												images={ pendingImages }
												onFilesSelected={ addPendingImages }
												onRemoveImage={ removePendingImage }
												acceptedFileTypes={ DOLLY_IMAGE_FILE_TYPES }
												maxFileSize={ DOLLY_IMAGE_MAX_FILE_SIZE }
												maxFiles={ DOLLY_IMAGE_MAX_FILES }
												dropZoneRef={ dollyDropZoneRef }
												onError={ setImageUploadError }
											/>
											<AgentUI.Input
												disabled={
													isInputDisabled ? true : pendingImages.length > 0 ? false : undefined
												}
												customActions={ dollyInputActions }
												layout="inline"
											/>
										</AgentUI.Footer>
										<DollyConversationMenu
											anchor={ chatMenuAnchor }
											conversations={ conversationsForTarget }
											selectedConversationId={ selectedConversationId }
											onClose={ () => setChatMenuAnchor( null ) }
											onNewChat={ startNewConversation }
											onSelect={ selectConversation }
											onDelete={ deleteConversation }
											isConversationActive={ ( conversationId ) =>
												Boolean( getWpcomSiteAssistantTurn( conversationId ) )
											}
										/>
										<div
											data-testid="guidelines-link"
											className="self-end px-2 pt-2 text-frame-text-secondary"
										>
											{ __( 'Powered by Dolly.' ) }
										</div>
									</AgentUI.ConversationView>
								</AgentUI.Container>
							</div>
						) : (
							<div className="mt-auto w-full">
								{ isOffline ? (
									<OfflineModeView />
								) : (
									<UnauthenticatedView onAuthenticate={ authenticate } />
								) }
							</div>
						) }
					</div>
					{ previewState.open && (
						<DollyPreviewPanel
							selectedSite={ activeWpcomSite }
							previewState={ previewState }
							previewUrl={ previewUrl }
							onUpdateState={ updatePreviewState }
						/>
					) }
				</div>
			</div>
		</div>
	);
}
