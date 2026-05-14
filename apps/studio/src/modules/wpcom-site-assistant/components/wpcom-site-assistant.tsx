import { AgentUI, ImageUploader, Suggestions } from '@automattic/agenttic-ui';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, desktop, Icon, image as imageIcon, trash } from '@wordpress/icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ClearHistoryReminder from 'src/components/ai-clear-history-reminder';
import { ArrowIcon } from 'src/components/arrow-icon';
import { Badge } from 'src/components/badge';
import Button from 'src/components/button';
import { ChatMessage } from 'src/components/chat-message';
import { ChatRating } from 'src/components/chat-rating';
import offlineIcon from 'src/components/offline-icon';
import { LIMIT_OF_PROMPTS_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import {
	DollyPreviewPanel,
	DollyPreviewPanelPortal,
} from 'src/modules/wpcom-site-assistant/components/wpcom-site-preview-panel';
import {
	fetchDollySite,
	hydrateWpcomSiteAssistantSessionState,
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
	initialPreviewState,
	normalizePreviewUrl,
} from 'src/modules/wpcom-site-assistant/lib/preview';
import {
	createWpcomSiteAssistantConversationId,
	createWpcomSiteAssistantSessionKey,
	getWpcomSiteAssistantSessionState,
	persistWpcomSiteAssistantSessionStateCache,
	shouldApplyWpcomSiteAssistantHydration,
	wpcomSiteAssistantSessionStateCache,
} from 'src/modules/wpcom-site-assistant/lib/session';
import {
	createDollyManageStagingSiteAbility,
	getKnownStagingCreationBlocker,
	getStagingCreationErrorMessage,
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
import { generateMessage, Message as MessageType } from 'src/stores/chat-slice';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';
import type { ToolProvider } from '@automattic/agenttic-client';
import type {
	AgentUIProps,
	ImageUploaderHandle,
	MessageAction,
	NoticeConfig as AgentticNoticeConfig,
	Suggestion,
	UploadedImage,
} from '@automattic/agenttic-ui';
import type { SyncSite } from '@studio/common/types/sync';

export { clearWpcomSiteAssistantStateCacheForTests } from 'src/modules/wpcom-site-assistant/lib/session';

const DollyChatRatingAction = ( {
	instanceId,
	messageApiId,
	feedbackReceived,
}: {
	instanceId: string;
	messageApiId: number;
	feedbackReceived: boolean;
} ) => (
	<ChatRating
		instanceId={ instanceId }
		messageApiId={ messageApiId }
		feedbackReceived={ feedbackReceived }
	/>
);

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

const DollyEmptyView = ( {
	suggestions,
	onSuggestionClick,
}: {
	suggestions?: Suggestion[];
	onSuggestionClick?: (
		selectedSuggestion: Suggestion,
		availableSuggestions: Suggestion[]
	) => void;
} ) => (
	<div className="flex h-full flex-col justify-end gap-3 px-4 py-3 text-sm text-frame-text-secondary">
		<div>{ __( 'Ask Dolly about this WordPress.com site.' ) }</div>
		<Suggestions
			suggestions={ suggestions }
			onSubmit={ onSuggestionClick }
			layout="vertical"
			translateY={ 0 }
		/>
	</div>
);

const getLiveSiteSafetyMessage = ( selectedSite: SyncSite ) => {
	const environment = getSiteEnvironment( selectedSite );

	if ( environment === 'staging' ) {
		return __( 'Dolly can edit this staging site.' );
	}

	if ( environment === 'development' ) {
		return __( 'Dolly can edit this development site.' );
	}

	return __( 'Dolly can edit this production site.' );
};

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

const LiveSiteSafetySignal = ( { selectedSite }: { selectedSite: SyncSite } ) => (
	<div
		data-testid="wpcom-live-site-safety-signal"
		className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-frame-text-secondary"
	>
		<Badge className="border border-a8c-gray-5 bg-white text-frame-text-secondary">
			{ __( 'Live site' ) }
		</Badge>
		<span>{ getLiveSiteSafetyMessage( selectedSite ) }</span>
	</div>
);

interface WpcomSiteAssistantProps {
	selectedWpcomSite: SyncSite;
}

export function WpcomSiteAssistant( { selectedWpcomSite }: WpcomSiteAssistantProps ) {
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const userId = user?.id;
	const isOffline = useOffline();
	const { setSelectedWpcomSite, setWpcomSiteActivity } = useSiteDetails();
	const [ createWpcomStagingSite, createWpcomStagingSiteResult ] =
		useCreateWpcomStagingSiteMutation();
	const sessionCacheKey = createWpcomSiteAssistantSessionKey( selectedWpcomSite.id );
	const initialSessionState = getWpcomSiteAssistantSessionState(
		sessionCacheKey,
		selectedWpcomSite
	);
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
	const selectedWpcomSiteIdRef = useRef( selectedWpcomSite.id );
	const conversationIdRef = useRef( initialSessionState.id );
	const remoteChatIdRef = useRef( initialSessionState.remoteChatId );
	const serverHydrationDisabledRef = useRef(
		Boolean( initialSessionState.serverHydrationDisabled )
	);
	const isAssistantThinkingRef = useRef( isAssistantThinking );
	const hydratedSessionKeysRef = useRef( new Set< string >() );
	const instanceId = userId
		? `dolly_${ userId }_wpcom_${ activeWpcomSite.id }`
		: `dolly_wpcom_${ activeWpcomSite.id }`;
	const previewUrl = useMemo(
		() => normalizePreviewUrl( activeWpcomSite.url, previewState.pathOrUrl ),
		[ activeWpcomSite.url, previewState.pathOrUrl ]
	);
	const siteAssociation = useMemo(
		() => createWpcomOnlySiteAssociationContext( activeWpcomSite ),
		[ activeWpcomSite ]
	);
	const previewContext = useMemo(
		() => createPreviewContext( activeWpcomSite, previewState, previewUrl ),
		[ activeWpcomSite, previewState, previewUrl ]
	);
	const siteEnvironment = getSiteEnvironment( activeWpcomSite );
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const failedMessageContent = messages.find( ( msg ) => msg.failedMessage )?.content;
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];
	const showCreateStagingSiteButton =
		! activeWpcomSite.isStaging &&
		! activeWpcomSite.isPressable &&
		! activeWpcomSite.stagingSiteIds?.length;
	const stagingCreationBlocker = getKnownStagingCreationBlocker( activeWpcomSite );
	const canCreateStagingSite = showCreateStagingSiteButton && ! stagingCreationBlocker;
	const isCreatingStagingSite = createWpcomStagingSiteResult.isLoading;
	const isCreatingStagingSiteForActiveSite =
		isCreatingStagingSite && stagingCreationSiteId === activeWpcomSite.id;
	const hasActiveAssistantTurn = useWpcomSiteAssistantTurn( sessionCacheKey );
	const isCurrentSessionAssistantThinking = isAssistantThinking || hasActiveAssistantTurn;
	const hadActiveAssistantTurnRef = useRef( hasActiveAssistantTurn );
	const locallyStartedTurnSessionKeysRef = useRef( new Set< string >() );
	const stagingCreationSiteIdRef = useRef< number | undefined >( undefined );
	const isAtLatestMessageRef = useRef( true );
	const previousMessageCountRef = useRef( messages.length );

	const updatePreviewState = useCallback( ( nextState: Partial< DollyPreviewState > ) => {
		setPreviewState( ( currentState ) => ( { ...currentState, ...nextState } ) );
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
			lastUpdated: Date.now(),
		};
		wpcomSiteAssistantSessionStateCache.set( sessionCacheKey, sessionState );
		persistWpcomSiteAssistantSessionStateCache();
	}, [
		activeWpcomSite,
		input,
		messages,
		previewState,
		selectedWpcomSite.id,
		sessionCacheKey,
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

		selectedWpcomSiteIdRef.current = selectedWpcomSite.id;
		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		conversationIdRef.current = nextSessionState.id;
		remoteChatIdRef.current = nextSessionState.remoteChatId;
		serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
		activeWpcomSiteRef.current = nextSessionState.activeWpcomSite;
		messagesRef.current = nextSessionState.messages;
		setActiveWpcomSite( nextSessionState.activeWpcomSite );
		setInput( nextSessionState.input );
		setMessages( nextSessionState.messages );
		setOptimisticMessageImages( {} );
		setSessionId( nextSessionState.sessionId );
		setIsAssistantThinking( Boolean( getWpcomSiteAssistantTurn( sessionCacheKey ) ) );
		setPreviewState( nextSessionState.previewState );
	}, [ selectedWpcomSite, sessionCacheKey ] );

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
	}, [ scrollToLatestMessage, sessionCacheKey ] );

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
				const cachedSessionState =
					wpcomSiteAssistantSessionStateCache.get( sessionCacheKey ) ??
					getWpcomSiteAssistantSessionState( sessionCacheKey, selectedWpcomSite );
				const hydratedSessionState = await hydrateWpcomSiteAssistantSessionState(
					client,
					selectedWpcomSite,
					cachedSessionState.sessionId
				);

				if (
					! hydratedSessionState ||
					! isCurrentHydration ||
					! isMountedRef.current ||
					isAssistantThinkingRef.current
				) {
					return;
				}

				const currentSessionState =
					wpcomSiteAssistantSessionStateCache.get( sessionCacheKey ) ??
					getWpcomSiteAssistantSessionState( sessionCacheKey, selectedWpcomSite );
				if (
					! shouldApplyWpcomSiteAssistantHydration( currentSessionState, hydratedSessionState )
				) {
					return;
				}

				const nextSessionState: WpcomSiteAssistantSessionState = {
					...hydratedSessionState,
					input: currentSessionState.input,
					activeWpcomSite: currentSessionState.activeWpcomSite,
					previewState: currentSessionState.previewState,
					serverHydrationDisabled: false,
				};

				conversationIdRef.current = nextSessionState.id;
				remoteChatIdRef.current = nextSessionState.remoteChatId;
				serverHydrationDisabledRef.current = false;
				wpcomSiteAssistantSessionStateCache.set( sessionCacheKey, nextSessionState );
				persistWpcomSiteAssistantSessionStateCache();
				setActiveWpcomSite( nextSessionState.activeWpcomSite );
				setInput( nextSessionState.input );
				setMessages( nextSessionState.messages );
				setOptimisticMessageImages( {} );
				setSessionId( nextSessionState.sessionId );
				setPreviewState( nextSessionState.previewState );
			} catch ( error ) {
				console.error( error );
			}
		} )();

		return () => {
			isCurrentHydration = false;
		};
	}, [ client, isAuthenticated, isOffline, selectedWpcomSite, sessionCacheKey ] );

	const openPreview = useCallback(
		( pathOrUrl = '/', title?: string, { forceReload = false }: OpenPreviewOptions = {} ) => {
			setPreviewState( ( currentState ) =>
				getNextPreviewState( currentState, pathOrUrl, title, { forceReload } )
			);
		},
		[]
	);

	const isVisibleSession = useCallback( ( targetSessionKey: string ) => {
		return (
			isMountedRef.current &&
			createWpcomSiteAssistantSessionKey( selectedWpcomSiteIdRef.current ) === targetSessionKey
		);
	}, [] );

	const writeCachedSessionState = useCallback(
		(
			targetSessionKey: string,
			targetSelectedWpcomSite: SyncSite,
			updater: (
				currentSessionState: WpcomSiteAssistantSessionState
			) => WpcomSiteAssistantSessionState
		) => {
			const currentSessionState =
				wpcomSiteAssistantSessionStateCache.get( targetSessionKey ) ??
				getWpcomSiteAssistantSessionState( targetSessionKey, targetSelectedWpcomSite );
			const nextSessionState = {
				...updater( currentSessionState ),
				lastUpdated: Date.now(),
			};
			wpcomSiteAssistantSessionStateCache.set( targetSessionKey, nextSessionState );
			persistWpcomSiteAssistantSessionStateCache();
			return nextSessionState;
		},
		[]
	);

	const applyVisibleSessionState = useCallback(
		(
			targetSessionKey: string,
			nextSessionState: WpcomSiteAssistantSessionState,
			{ clearOptimisticImages = false }: { clearOptimisticImages?: boolean } = {}
		) => {
			if ( ! isVisibleSession( targetSessionKey ) ) {
				return;
			}

			conversationIdRef.current = nextSessionState.id;
			remoteChatIdRef.current = nextSessionState.remoteChatId;
			serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
			messagesRef.current = nextSessionState.messages;
			setActiveWpcomSite( nextSessionState.activeWpcomSite );
			setInput( nextSessionState.input );
			setMessages( nextSessionState.messages );
			setSessionId( nextSessionState.sessionId );
			setPreviewState( nextSessionState.previewState );
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

		if ( locallyStartedTurnSessionKeysRef.current.delete( sessionCacheKey ) ) {
			return;
		}

		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		applyVisibleSessionState( sessionCacheKey, nextSessionState );
		setIsAssistantThinking( false );
	}, [
		applyVisibleSessionState,
		hasActiveAssistantTurn,
		isAssistantThinking,
		selectedWpcomSite,
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
	}, [ getMessagesScrollArea, isMessagesScrollAreaAtLatest, sessionCacheKey ] );

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
						setSelectedWpcomSite( stagingSite );
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
		[ createWpcomStagingSite, setSelectedWpcomSite, setWpcomSiteActivity, userId ]
	);

	const createStagingSiteForActiveSite = useCallback(
		( options?: { selectWpcomSite?: boolean } ) =>
			createStagingSiteForSite( activeWpcomSiteRef.current, options ),
		[ createStagingSiteForSite ]
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
						const nextSessionState = writeCachedSessionState(
							targetSessionKey,
							targetSelectedWpcomSite,
							( currentSessionState ) => ( {
								...currentSessionState,
								previewState: getNextPreviewState(
									currentSessionState.previewState,
									pathOrUrl,
									title,
									options
								),
							} )
						);

						if ( isVisibleSession( targetSessionKey ) ) {
							setPreviewState( nextSessionState.previewState );
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
		[
			applyVisibleSessionState,
			createStagingSiteForSite,
			isVisibleSession,
			writeCachedSessionState,
		]
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
			const targetSessionKey = sessionCacheKey;
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
			locallyStartedTurnSessionKeysRef.current.add( targetSessionKey );
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
			selectedWpcomSite,
			sessionCacheKey,
			sessionId,
			siteAssociation,
			syncBackendActiveWpcomSite,
			setWpcomSiteActivity,
			writeCachedSessionState,
		]
	);

	const clearConversation = useCallback( () => {
		conversationIdRef.current = createWpcomSiteAssistantConversationId();
		remoteChatIdRef.current = undefined;
		serverHydrationDisabledRef.current = true;
		setInput( '' );
		setMessages( [] );
		setOptimisticMessageImages( {} );
		setSessionId( undefined );
		setActiveWpcomSite( selectedWpcomSite );
		setPreviewState( initialPreviewState() );
		clearPendingImages();
	}, [ clearPendingImages, selectedWpcomSite ] );

	const confirmAndClearConversation = useCallback( async () => {
		if ( localStorage.getItem( 'dontShowClearMessagesWarning' ) === 'true' ) {
			clearConversation();
			return;
		}

		const CLEAR_CONVERSATION_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
			message: __( 'Are you sure you want to clear the conversation?' ),
			checkboxLabel: __( "Don't show this warning again" ),
			buttons: [ __( 'OK' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === CLEAR_CONVERSATION_BUTTON_INDEX ) {
			if ( checkboxChecked ) {
				localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
			}

			clearConversation();
		}
	}, [ clearConversation ] );

	const agentticMessages = useMemo< AgentUIProps[ 'messages' ] >(
		() =>
			messages.map( ( message ) => {
				const actions: MessageAction[] = [];
				const messageKey = String( message.id ?? message.createdAt );
				const optimisticImageAttachment = optimisticMessageImages[ messageKey ];

				if ( message.role === 'assistant' && message.messageApiId ) {
					actions.push( {
						type: 'component',
						id: `rating-${ message.messageApiId }`,
						label: __( 'Rate message' ),
						component: DollyChatRatingAction,
						componentProps: {
							instanceId,
							messageApiId: message.messageApiId,
							feedbackReceived: Boolean( message.feedbackReceived ),
						},
					} );
				}

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
					actions: actions.length ? actions : undefined,
				};
			} ),
		[ instanceId, messages, optimisticMessageImages ]
	);

	const retryFailedMessage = useCallback( () => {
		if ( failedMessageContent ) {
			submitPrompt( failedMessageContent, true );
		}
	}, [ failedMessageContent, submitPrompt ] );

	const interruptDollyRequest = useCallback( () => {
		abortWpcomSiteAssistantTurn( sessionCacheKey );
	}, [ sessionCacheKey ] );

	const persistStagingSiteConversation = useCallback(
		( stagingSite: SyncSite, nextMessages: MessageType[] ) => {
			const stagingSessionKey = createWpcomSiteAssistantSessionKey( stagingSite.id );
			wpcomSiteAssistantSessionStateCache.set( stagingSessionKey, {
				id: createWpcomSiteAssistantConversationId(),
				key: {
					siteId: stagingSite.id,
					agentId: DOLLY_AGENT_ID,
				},
				remoteChatId: undefined,
				serverHydrationDisabled: true,
				input: '',
				messages: nextMessages,
				sessionId: undefined,
				activeWpcomSite: stagingSite,
				previewState: initialPreviewState(),
				lastUpdated: Date.now(),
			} );
			persistWpcomSiteAssistantSessionStateCache();
		},
		[]
	);

	const createStagingSiteFromHeader = useCallback( async () => {
		if ( ! canCreateStagingSite || isCreatingStagingSite || isAssistantThinkingRef.current ) {
			return;
		}

		const site = activeWpcomSiteRef.current;

		try {
			await createStagingSiteForActiveSite( { selectWpcomSite: true } );
		} catch ( error ) {
			if ( ! isMountedRef.current ) {
				return;
			}

			getIpcApi().showErrorMessageBox( {
				title: __( 'Could not create staging site' ),
				message: getStagingCreationErrorMessage( error, site ),
			} );
		}
	}, [ canCreateStagingSite, createStagingSiteForActiveSite, isCreatingStagingSite ] );

	const createStagingSiteFromChat = useCallback( async () => {
		if ( ! canCreateStagingSite || isCreatingStagingSite || isAssistantThinkingRef.current ) {
			return;
		}

		const site = activeWpcomSiteRef.current;
		const prompt = __( 'Make a staging site' );
		const startingMessages: MessageType[] = messagesRef.current.map( ( message ) => ( {
			...message,
			failedMessage: false,
		} ) );
		const userMessage = generateMessage( prompt, 'user', startingMessages.length );
		const messagesWithUserPrompt: MessageType[] = [ ...startingMessages, userMessage ];

		messagesRef.current = messagesWithUserPrompt;
		setInput( '' );
		setMessages( messagesWithUserPrompt );
		setIsAssistantThinking( true );

		try {
			const stagingSite = await createStagingSiteForActiveSite();

			if ( ! isMountedRef.current ) {
				return;
			}

			const assistantMessage = generateMessage(
				sprintf(
					__(
						"Done! Here's your staging site: %s\n\nYou can safely make changes here without impacting your production site. What do you want to do?"
					),
					stagingSite.url
				),
				'assistant',
				messagesWithUserPrompt.length
			);
			const finalMessages: MessageType[] = [ ...messagesWithUserPrompt, assistantMessage ];
			messagesRef.current = finalMessages;
			setMessages( finalMessages );
			setIsAssistantThinking( false );
			persistStagingSiteConversation( stagingSite, finalMessages );
			setSelectedWpcomSite( stagingSite );
		} catch ( error ) {
			if ( ! isMountedRef.current ) {
				return;
			}

			const assistantMessage = generateMessage(
				sprintf(
					/* translators: %s is the WordPress.com staging site creation error message. */
					__( "I couldn't create a staging site.\n\n%s" ),
					getStagingCreationErrorMessage( error, site )
				),
				'assistant',
				messagesWithUserPrompt.length
			);
			const finalMessages: MessageType[] = [ ...messagesWithUserPrompt, assistantMessage ];
			messagesRef.current = finalMessages;
			setMessages( finalMessages );
		} finally {
			if ( isMountedRef.current ) {
				setIsAssistantThinking( false );
			}
		}
	}, [
		canCreateStagingSite,
		createStagingSiteForActiveSite,
		isCreatingStagingSite,
		persistStagingSiteConversation,
		setSelectedWpcomSite,
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
	const isCreateStagingSiteButtonDisabled =
		! canCreateStagingSite ||
		isCreatingStagingSite ||
		isCurrentSessionAssistantThinking ||
		isOffline ||
		! isAuthenticated ||
		! client;
	const createStagingSiteTooltip = isCurrentSessionAssistantThinking
		? __( 'Wait for Dolly to finish before creating a staging site.' )
		: stagingCreationBlocker;

	const dollyInputActions = useMemo(
		() => [
			{
				id: 'upload-image',
				icon: <Icon icon={ imageIcon } size={ 18 } />,
				onClick: () => imageUploaderRef.current?.openFileDialog(),
				variant: 'ghost' as const,
				disabled: isInputActionDisabled,
				'aria-label': __( 'Upload image' ),
			},
			...( messages.length > 0
				? [
						{
							id: 'clear-conversation',
							icon: <Icon icon={ trash } size={ 18 } />,
							onClick: () => {
								void confirmAndClearConversation();
							},
							variant: 'ghost' as const,
							'aria-label': __( 'Clear conversation' ),
						},
				  ]
				: [] ),
		],
		[ confirmAndClearConversation, isInputActionDisabled, messages.length ]
	);

	const dollySuggestions = useMemo< Suggestion[] >(
		() =>
			messages.length === 0 && canCreateStagingSite && ! isInputUnavailable
				? [
						{
							id: 'create-staging-site',
							label: __( 'Make a staging site' ),
							prompt: __( 'Make a staging site' ),
							action: async () => {
								await createStagingSiteFromChat();
								return false;
							},
						},
				  ]
				: [],
		[ canCreateStagingSite, createStagingSiteFromChat, isInputUnavailable, messages.length ]
	);

	const dollyEmptyView = useMemo(
		() => <DollyEmptyView suggestions={ dollySuggestions } />,
		[ dollySuggestions ]
	);

	const renderConversationReminder = () => {
		if ( isAuthenticated && messages.length > 0 ) {
			return (
				<ClearHistoryReminder lastMessage={ lastMessage } clearConversation={ clearConversation } />
			);
		}
	};

	return (
		<div className="relative h-full min-w-0 flex flex-1 overflow-hidden bg-frame-surface">
			<div className="min-w-0 flex-1 flex flex-col">
				<div className="shrink-0 border-b border-a8c-gray-5 bg-white px-8 py-5 flex items-start gap-4">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2">
							<h1 className="m-0 truncate text-xl font-semibold text-frame-text">
								{ activeWpcomSite.name }
							</h1>
							<EnvironmentBadge type={ siteEnvironment } />
							<Badge className="bg-frame-surface text-frame-text-secondary">
								{ __( 'WordPress.com' ) }
							</Badge>
						</div>
						<div className="mt-1 truncate text-sm text-frame-text-secondary">
							{ activeWpcomSite.url }
						</div>
						<LiveSiteSafetySignal selectedSite={ activeWpcomSite } />
					</div>
					<div className="flex shrink-0 flex-wrap justify-end gap-2">
						{ showCreateStagingSiteButton && (
							<Button
								variant="secondary"
								onClick={ () => void createStagingSiteFromHeader() }
								disabled={ isCreateStagingSiteButtonDisabled }
								aria-disabled={ isCreateStagingSiteButtonDisabled }
								tooltipText={ createStagingSiteTooltip }
							>
								{ isCreatingStagingSiteForActiveSite
									? __( 'Creating staging...' )
									: __( 'Create staging site' ) }
							</Button>
						) }
						{ ! previewState.open && (
							<Button variant="secondary" onClick={ () => openPreview( previewState.pathOrUrl ) }>
								<Icon icon={ desktop } size={ 18 } />
								{ __( 'Show preview' ) }
							</Button>
						) }
					</div>
				</div>
				<div
					data-testid="assistant-chat"
					ref={ dollyDropZoneRef }
					className={ cx( 'min-h-0 flex-1', ! isAuthenticated && 'overflow-y-auto p-8 pb-2' ) }
				>
					{ isAuthenticated ? (
						<div className="agenttic dolly-agenttic-chat h-full min-h-0">
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
								suggestions={ dollySuggestions }
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
									className="relative min-h-0 px-6 py-6"
								>
									<AgentUI.Messages key={ sessionCacheKey } />
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
									{ messages.length > 0 && (
										<div className="px-4 pb-2 text-frame-text-secondary">
											{ renderConversationReminder() }
										</div>
									) }
									<AgentUI.Footer className="mx-2 bg-white">
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
									<div
										data-testid="guidelines-link"
										className="text-frame-text-secondary self-end pt-2 px-2"
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
			</div>
			{ previewState.open && (
				<DollyPreviewPanelPortal>
					<DollyPreviewPanel
						selectedSite={ activeWpcomSite }
						previewState={ previewState }
						previewUrl={ previewUrl }
						onClose={ () => updatePreviewState( { open: false } ) }
						onRefresh={ () =>
							setPreviewState( ( currentState ) => ( {
								...currentState,
								isLoading: true,
								reloadNonce: currentState.reloadNonce + 1,
							} ) )
						}
						onUpdateState={ updatePreviewState }
					/>
				</DollyPreviewPanelPortal>
			) }
		</div>
	);
}
