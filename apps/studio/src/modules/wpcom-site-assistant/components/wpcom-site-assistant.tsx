import { useClientAbilities } from '@automattic/agenttic-client';
import { AgentUI, ImageUploader } from '@automattic/agenttic-ui';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { desktop, Icon, image as imageIcon, trash } from '@wordpress/icons';
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
	getErrorMessage,
	isDollyRequestAbortError,
	sendDollyMessage,
} from 'src/modules/wpcom-site-assistant/lib/transport';
import {
	DOLLY_AGENT_ID,
	DOLLY_IMAGE_FILE_TYPES,
	DOLLY_IMAGE_MAX_FILE_SIZE,
	DOLLY_IMAGE_MAX_FILES,
	type DollyMessageImageAttachment,
	type DollyPendingImage,
	type DollyPreviewState,
	type OpenPreviewOptions,
	type WpcomSiteAssistantSessionState,
} from 'src/modules/wpcom-site-assistant/lib/types';
import { generateMessage, Message as MessageType } from 'src/stores/chat-slice';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';
import type {
	AgentUIProps,
	ImageUploaderHandle,
	MessageAction,
	NoticeConfig as AgentticNoticeConfig,
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
	onSuggestionClick: _onSuggestionClick,
}: {
	onSuggestionClick?: unknown;
} ) => (
	<div className="flex h-full items-end px-4 py-3 text-sm text-frame-text-secondary">
		{ __( 'Ask Dolly about this WordPress.com site.' ) }
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

const getRecord = ( value: unknown ) =>
	value && typeof value === 'object' ? ( value as Record< string, unknown > ) : undefined;

const getStringValue = ( value: unknown ) => ( typeof value === 'string' ? value : undefined );

const getNumberValue = ( value: unknown ) => ( typeof value === 'number' ? value : undefined );

const getStagingCreationErrorDetails = ( error: unknown ) => {
	const errorRecord = getRecord( error );
	const data = errorRecord && 'data' in errorRecord ? errorRecord.data : error;
	const dataRecord = getRecord( data );
	const nestedDataRecord = getRecord( dataRecord?.data );

	return {
		code:
			getStringValue( dataRecord?.code ) ??
			getStringValue( dataRecord?.error ) ??
			getStringValue( errorRecord?.code ) ??
			getStringValue( errorRecord?.error ),
		message:
			data instanceof Error
				? data.message
				: getStringValue( dataRecord?.message ) ??
				  getStringValue( errorRecord?.message ) ??
				  ( error instanceof Error ? error.message : undefined ),
		status:
			getNumberValue( errorRecord?.status ) ??
			getNumberValue( dataRecord?.status ) ??
			getNumberValue( dataRecord?.statusCode ) ??
			getNumberValue( nestedDataRecord?.status ),
	};
};

const getStagingCreationErrorHint = ( code?: string ) => {
	switch ( code ) {
		case 'rest_cannot_view':
			return __(
				'This looks like an API permission restriction. The site may be eligible, but this OAuth client may not be allowed to manage staging sites for it yet.'
			);
		case 'staging_site_cannot_create':
			return __( 'WordPress.com says this site is not eligible for a staging site.' );
		case 'staging_site_cannot_create_more':
			return __( 'This production site already has the maximum number of staging sites.' );
		case 'staging_site_cannot_create_locked':
			return __( 'A staging-site creation is already in progress for this site.' );
		case 'staging_site_cannot_create_space_quota':
			return __( 'The site needs at least 50% free storage before staging can be created.' );
		case 'staging_site_cannot_create_jetpack_database_connection':
			return __(
				'Jetpack could not connect to the site database, so WordPress.com could not create the staging site.'
			);
		default:
			return undefined;
	}
};

const getKnownStagingCreationBlocker = ( site: SyncSite ) => {
	if ( site.canManageOptions === false ) {
		return __( 'Your WordPress.com user needs admin access to create a staging site.' );
	}

	if ( site.hasStagingSiteFeature === false ) {
		return __( "This site's plan does not include staging sites." );
	}

	if ( site.isWpcomAtomic === false && site.hasStagingSiteFeature !== true ) {
		return __( 'This site does not appear to have WordPress.com hosting features enabled.' );
	}

	return undefined;
};

const getStagingCreationErrorMessage = ( error: unknown, site: SyncSite ) => {
	const { code, message, status } = getStagingCreationErrorDetails( error );
	const details = [
		message ?? __( 'Studio could not create a staging site. Please try again.' ),
		code || status
			? sprintf(
					/* translators: %1$s is a WordPress.com API error code, %2$s is an HTTP status code. */
					__( 'WordPress.com returned %1$s%2$s.' ),
					code ? `code "${ code }"` : __( 'an error' ),
					status ? ` (${ status })` : ''
			  )
			: undefined,
		getStagingCreationErrorHint( code ) ?? getKnownStagingCreationBlocker( site ),
	].filter( ( value ): value is string => Boolean( value ) );

	return details.join( '\n\n' );
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
	const { setSelectedWpcomSite } = useSiteDetails();
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
	const [ optimisticMessageImages, setOptimisticMessageImages ] = useState<
		Record< string, DollyMessageImageAttachment >
	>( {} );
	const selectionRevisionRef = useRef( 0 );
	const isMountedRef = useRef( true );
	const imageUploaderRef = useRef< ImageUploaderHandle >( null );
	const dollyDropZoneRef = useRef< HTMLDivElement >( null );
	const pendingImagesRef = useRef< DollyPendingImage[] >( pendingImages );
	const dollyRequestAbortControllerRef = useRef< AbortController | undefined >( undefined );
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

	useEffect( () => () => revokeDollyPendingImageUrls( pendingImagesRef.current ), [] );

	useEffect( () => {
		isAssistantThinkingRef.current = isAssistantThinking;
	}, [ isAssistantThinking ] );

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
			dollyRequestAbortControllerRef.current?.abort();
			dollyRequestAbortControllerRef.current = undefined;
		};
	}, [] );

	useEffect( () => {
		if ( selectedWpcomSiteIdRef.current === selectedWpcomSite.id ) {
			return;
		}

		selectionRevisionRef.current += 1;
		dollyRequestAbortControllerRef.current?.abort();
		dollyRequestAbortControllerRef.current = undefined;
		selectedWpcomSiteIdRef.current = selectedWpcomSite.id;
		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		conversationIdRef.current = nextSessionState.id;
		remoteChatIdRef.current = nextSessionState.remoteChatId;
		serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
		setActiveWpcomSite( nextSessionState.activeWpcomSite );
		setInput( nextSessionState.input );
		setMessages( nextSessionState.messages );
		setOptimisticMessageImages( {} );
		setSessionId( nextSessionState.sessionId );
		setIsAssistantThinking( false );
		setPreviewState( nextSessionState.previewState );
	}, [ selectedWpcomSite, sessionCacheKey ] );

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
			setPreviewState( ( currentState ) => {
				const shouldLoad =
					forceReload || ! currentState.open || currentState.pathOrUrl !== pathOrUrl;

				return {
					...currentState,
					open: true,
					pathOrUrl,
					title,
					pageTitle: shouldLoad ? undefined : currentState.pageTitle,
					currentUrl: shouldLoad ? undefined : currentState.currentUrl,
					isLoading: shouldLoad ? true : currentState.isLoading,
					reloadNonce: forceReload ? currentState.reloadNonce + 1 : currentState.reloadNonce,
				};
			} );
		},
		[]
	);

	const getDollyPreviewAbilities = useCallback(
		async () =>
			createDollyPreviewAbilities( {
				activeWpcomSite,
				previewState,
				openPreview,
			} ),
		[ activeWpcomSite, openPreview, previewState ]
	);
	const dollyToolProvider = useClientAbilities( getDollyPreviewAbilities );

	const syncBackendActiveWpcomSite = useCallback(
		async ( backendSelectedSiteId: number | undefined, requestSelectionRevision: number ) => {
			if (
				! client ||
				! backendSelectedSiteId ||
				activeWpcomSiteRef.current.id === backendSelectedSiteId ||
				selectionRevisionRef.current !== requestSelectionRevision
			) {
				return;
			}

			const nextSite = await fetchDollySite( client, backendSelectedSiteId );
			if (
				nextSite &&
				isMountedRef.current &&
				selectionRevisionRef.current === requestSelectionRevision
			) {
				setActiveWpcomSite( nextSite );
			}
		},
		[ client ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			const imagesToSend = isRetry ? [] : pendingImages;
			if (
				( ! trimmedMessage && imagesToSend.length === 0 ) ||
				! client ||
				isAssistantThinking ||
				selectedWpcomSiteIdRef.current !== selectedWpcomSite.id
			) {
				return;
			}

			if ( ! isRetry ) {
				setInput( '' );
			}

			const messageToSend =
				trimmedMessage ||
				( imagesToSend.length > 0 ? createDollyImagePrompt( imagesToSend.length ) : '' );
			const newMessageId = isRetry ? messages.length - 1 : messages.length;
			const optimisticImagesPromise = createDollyPendingVisibleImages( imagesToSend );
			const abortController = new AbortController();
			dollyRequestAbortControllerRef.current = abortController;

			if ( ! isRetry && imagesToSend.length > 0 ) {
				setPendingImages( [] );
				setImageUploadError( undefined );
				revokeDollyPendingImageUrls( imagesToSend );
			}

			setIsAssistantThinking( true );
			const requestSelectionRevision = selectionRevisionRef.current;
			const isCurrentTurn = () =>
				isMountedRef.current && selectionRevisionRef.current === requestSelectionRevision;

			void ( async () => {
				let optimisticMessage: MessageType | undefined;
				try {
					const optimisticImages = await optimisticImagesPromise;
					const nextOptimisticMessage = generateMessage( messageToSend, 'user', newMessageId );
					optimisticMessage = nextOptimisticMessage;
					if ( optimisticImages.length > 0 ) {
						setOptimisticMessageImages( ( currentImages ) => ( {
							...currentImages,
							[ nextOptimisticMessage.id ?? nextOptimisticMessage.createdAt ]: {
								text: messageToSend,
								images: optimisticImages,
							},
						} ) );
					}
					setMessages( ( currentMessages ) => {
						if ( ! isRetry ) {
							return [
								...currentMessages.map( ( currentMessage ) => ( {
									...currentMessage,
									failedMessage: false,
								} ) ),
								nextOptimisticMessage,
							];
						}

						return currentMessages.map( ( currentMessage ) =>
							currentMessage.id === nextOptimisticMessage.id
								? { ...nextOptimisticMessage, failedMessage: false }
								: currentMessage
						);
					} );

					const uploadedImages = await uploadDollyImages(
						activeWpcomSite.id,
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
						setMessages( ( currentMessages ) =>
							currentMessages.map( ( currentMessage ) =>
								currentMessage.id === optimisticMessage?.id
									? { ...currentMessage, content: visibleMessage }
									: currentMessage
							)
						);
						void preloadDollyImageUrls( uploadedVisibleImages ).then( () => {
							if ( ! isCurrentTurn() ) {
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
						previewContext,
						siteAssociation,
						selectedSite: activeWpcomSite,
						sessionId,
						siteId: activeWpcomSite.id,
						toolProvider: dollyToolProvider,
					} );

					if ( ! isMountedRef.current ) {
						return;
					}

					if ( response.sessionId ) {
						setSessionId( response.sessionId );
					}

					if ( response.text.trim() ) {
						setMessages( ( currentMessages ) => [
							...currentMessages,
							generateMessage( response.text, 'assistant', currentMessages.length ),
						] );
					}

					void resolveBackendSelectedSiteId( client, response, sessionId ).then(
						( backendSelectedSiteId ) => {
							if ( isCurrentTurn() ) {
								void syncBackendActiveWpcomSite( backendSelectedSiteId, requestSelectionRevision );
							}
						}
					);
				} catch ( error ) {
					if ( ! isMountedRef.current ) {
						return;
					}
					if ( isDollyRequestAbortError( error ) || abortController.signal.aborted ) {
						return;
					}
					console.error( error );
					setImageUploadError( getErrorMessage( error ) );
					if ( ! isRetry ) {
						setInput( chatMessage );
					}
					setMessages( ( currentMessages ) =>
						currentMessages.map( ( currentMessage ) =>
							currentMessage.id === optimisticMessage?.id
								? { ...currentMessage, failedMessage: true }
								: currentMessage
						)
					);
				} finally {
					const isCurrentRequest = dollyRequestAbortControllerRef.current === abortController;
					if ( isCurrentRequest ) {
						dollyRequestAbortControllerRef.current = undefined;
						if ( isMountedRef.current ) {
							setIsAssistantThinking( false );
						}
					}
				}
			} )();
		},
		[
			client,
			dollyToolProvider,
			isAssistantThinking,
			messages.length,
			activeWpcomSite,
			pendingImages,
			previewContext,
			selectedWpcomSite.id,
			sessionId,
			siteAssociation,
			syncBackendActiveWpcomSite,
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
		dollyRequestAbortControllerRef.current?.abort();
	}, [] );

	const createStagingSite = useCallback( async () => {
		if ( ! canCreateStagingSite || isCreatingStagingSite ) {
			return;
		}

		try {
			const stagingSite = await createWpcomStagingSite( {
				site: activeWpcomSite,
				userId,
			} ).unwrap();

			if ( ! isMountedRef.current ) {
				return;
			}

			setActiveWpcomSite( stagingSite );
			setSelectedWpcomSite( stagingSite );
		} catch ( error ) {
			if ( ! isMountedRef.current ) {
				return;
			}

			getIpcApi().showErrorMessageBox( {
				title: __( 'Could not create staging site' ),
				message: getStagingCreationErrorMessage( error, activeWpcomSite ),
			} );
		}
	}, [
		activeWpcomSite,
		canCreateStagingSite,
		createWpcomStagingSite,
		isCreatingStagingSite,
		setSelectedWpcomSite,
		userId,
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
	const isInputDisabled = isInputUnavailable && ! isAssistantThinking;
	const isInputActionDisabled = isInputUnavailable || isAssistantThinking;

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

	const dollyEmptyView = useMemo( () => <DollyEmptyView />, [] );

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
								onClick={ () => void createStagingSite() }
								disabled={
									! canCreateStagingSite ||
									isCreatingStagingSite ||
									isOffline ||
									! isAuthenticated ||
									! client
								}
								aria-disabled={
									! canCreateStagingSite ||
									isCreatingStagingSite ||
									isOffline ||
									! isAuthenticated ||
									! client
								}
								tooltipText={ stagingCreationBlocker }
							>
								{ isCreatingStagingSite
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
								isProcessing={ isAssistantThinking }
								error={ null }
								onSubmit={ submitPrompt }
								onStop={ interruptDollyRequest }
								variant="embedded"
								placeholder={ __( 'Ask Dolly about this site' ) }
								notice={ dollyNotice }
								emptyView={ dollyEmptyView }
								messagesPosition="bottom"
								inputValue={ input }
								onInputChange={ setInput }
								maxInputLength={ 10000 }
								thinkingMessage={ __( 'Thinking...' ) }
								className="h-full min-h-0 bg-frame-surface"
							>
								<AgentUI.ConversationView showHeader={ false } className="min-h-0 px-6 py-6">
									<AgentUI.Messages />
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
