import { AgentUI, ImageUploader, createMessageRenderer } from '@automattic/agenttic-ui';
import { Popover } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, Icon, image as imageIcon, moreVertical, plus, trash } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { ChatMessage } from 'src/components/chat-message';
import offlineIcon from 'src/components/offline-icon';
import { LIMIT_OF_PROMPTS_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { cx } from 'src/lib/cx';
import { hydrateWorkspaceDollyConversationStates } from 'src/modules/workspaces/lib/dolly/api';
import {
	WORKSPACE_DOLLY_IMAGE_PREVIEW_CLASS_NAME,
	WORKSPACE_DOLLY_IMAGE_PREVIEW_STYLE,
	WorkspaceDollyOptimisticImages,
	createWorkspaceDollyImagePrompt,
	createWorkspaceDollyPendingVisibleImages,
	createWorkspaceDollyVisibleMessage,
	isWorkspaceDollyRenderableImageLinkUrl,
	isWorkspaceDollyRenderableImageUrl,
	readWorkspaceDollyFileAsDataUrl,
	revokeWorkspaceDollyPendingImageUrls,
	uploadWorkspaceDollyImages,
} from 'src/modules/workspaces/lib/dolly/media';
import {
	createWorkspaceDollyPreviewAbilities,
	createWorkspaceDollyPreviewContext,
	createWorkspaceDollySiteAssociationContext,
	getNextWorkspaceDollyPreviewState,
	normalizeWorkspaceDollyPreviewUrl,
} from 'src/modules/workspaces/lib/dolly/preview';
import {
	createNewWorkspaceDollyConversation,
	deleteWorkspaceDollyConversation,
	getCachedWorkspaceDollyConversationState,
	getWorkspaceDollyConversationState,
	getWorkspaceDollyConversationsForTarget,
	mergeWorkspaceDollyConversationState,
	setSelectedWorkspaceDollyConversationId,
	writeWorkspaceDollyConversationState,
} from 'src/modules/workspaces/lib/dolly/session';
import {
	getWorkspaceDollyErrorMessage,
	isWorkspaceDollyRequestAbortError,
	sendWorkspaceDollyMessage,
} from 'src/modules/workspaces/lib/dolly/transport';
import {
	abortWorkspaceDollyTurn,
	finishWorkspaceDollyTurn,
	getWorkspaceDollyTargetActivityKey,
	getWorkspaceDollyTurn,
	setWorkspaceDollyTargetUnread,
	startWorkspaceDollyTurn,
	useWorkspaceDollyConversationTurn,
} from 'src/modules/workspaces/lib/dolly/turns';
import {
	WORKSPACE_DOLLY_IMAGE_FILE_TYPES,
	WORKSPACE_DOLLY_IMAGE_MAX_FILE_SIZE,
	WORKSPACE_DOLLY_IMAGE_MAX_FILES,
} from 'src/modules/workspaces/lib/dolly/types';
import { generateMessage, type Message as MessageType } from 'src/stores/chat-slice';
import type { ToolProvider } from '@automattic/agenttic-client';
import type {
	AgentUIProps,
	ImageUploaderHandle,
	NoticeConfig as AgentticNoticeConfig,
	UploadedImage,
} from '@automattic/agenttic-ui';
import type { WorkspacePreviewState } from 'src/modules/workspaces/components/workspace-preview';
import type {
	WorkspaceDollyConversationState,
	WorkspaceDollyMessageImageAttachment,
	WorkspaceDollyPendingImage,
	WorkspaceDollyTargetDescriptor,
	WorkspaceDollyUploadedImage,
} from 'src/modules/workspaces/lib/dolly/types';
import type { RemoteTarget, StudioWorkspace } from 'src/modules/workspaces/types';

type WorkspaceDollyAssistantProps = {
	workspace: StudioWorkspace;
	target: RemoteTarget;
	previewState: WorkspacePreviewState;
	onUpdatePreviewState: ( state: WorkspacePreviewState ) => void;
};

function OfflineModeView() {
	return (
		<div className="flex items-center justify-center gap-1 px-2 pt-4 text-frame-text-secondary">
			<Icon className="m-1 fill-frame-text-secondary" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">
				{ __( 'The AI assistant requires an internet connection.' ) }
			</span>
		</div>
	);
}

function UnauthenticatedView( { onAuthenticate }: { onAuthenticate: () => void } ) {
	return (
		<ChatMessage
			id="message-unauthenticated"
			className="w-full"
			message={ { role: 'user' } as MessageType }
			isUnauthenticated
			instanceId=""
		>
			<div data-testid="unauthenticated-header" className="mb-3 a8c-label-semibold">
				{ __( 'Hold up!' ) }
			</div>
			<div className="mb-1">
				{ __( 'You need to log in to your WordPress.com account to use Dolly.' ) }
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
}

function WorkspaceDollyEmptyView() {
	return <div className="h-full" aria-hidden="true" />;
}

const isBlankConversation = ( conversation: WorkspaceDollyConversationState ) =>
	conversation.messages.length === 0 && ! conversation.input.trim();

const getConversationUpdatedLabel = ( conversation: WorkspaceDollyConversationState ) =>
	new Intl.DateTimeFormat( undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	} ).format( new Date( conversation.lastUpdated ) );

const getConversationLabel = ( conversation: WorkspaceDollyConversationState ) => {
	const firstUserMessage = conversation.messages.find( ( message ) => message.role === 'user' );
	const fallbackDate = getConversationUpdatedLabel( conversation );

	if ( firstUserMessage?.content.trim() ) {
		return firstUserMessage.content.trim().replace( /\s+/g, ' ' ).slice( 0, 64 );
	}

	return sprintf( __( 'Chat from %s' ), fallbackDate );
};

const shouldShowConversationControls = (
	conversations: WorkspaceDollyConversationState[],
	selectedConversation?: WorkspaceDollyConversationState
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
	conversations: WorkspaceDollyConversationState[];
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

			if ( anchor.contains( target ) || menuRef.current?.contains( target ) ) {
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
									onClose();
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
									getConversationLabel( conversation )
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

export function WorkspaceDollyAssistant( {
	workspace,
	target,
	previewState,
	onUpdatePreviewState,
}: WorkspaceDollyAssistantProps ) {
	const { isAuthenticated, authenticate, client } = useAuth();
	const isOffline = useOffline();
	const targetDescriptor = useMemo< WorkspaceDollyTargetDescriptor >(
		() => ( {
			workspaceId: workspace.id,
			targetId: target.id,
			site: target.site,
		} ),
		[ target.id, target.site, workspace.id ]
	);
	const initialConversationState = getWorkspaceDollyConversationState( targetDescriptor );
	const [ selectedConversationId, setSelectedConversationId ] = useState(
		initialConversationState.id
	);
	const [ conversationListVersion, setConversationListVersion ] = useState( 0 );
	const [ input, setInput ] = useState( initialConversationState.input );
	const [ messages, setMessages ] = useState< MessageType[] >( initialConversationState.messages );
	const [ sessionId, setSessionId ] = useState< string | undefined >(
		initialConversationState.sessionId
	);
	const [ pendingImages, setPendingImages ] = useState< WorkspaceDollyPendingImage[] >( [] );
	const [ imageUploadError, setImageUploadError ] = useState< string | undefined >();
	const [ optimisticMessageImages, setOptimisticMessageImages ] = useState<
		Record< string, WorkspaceDollyMessageImageAttachment >
	>( {} );
	const [ isAssistantThinking, setIsAssistantThinking ] = useState(
		Boolean( getWorkspaceDollyTurn( initialConversationState.id ) )
	);
	const [ errorMessage, setErrorMessage ] = useState< string | undefined >();
	const [ chatMenuAnchor, setChatMenuAnchor ] = useState< Element | null >( null );
	const [ showJumpToLatest, setShowJumpToLatest ] = useState( false );
	const isMountedRef = useRef( true );
	const imageUploaderRef = useRef< ImageUploaderHandle >( null );
	const dollyDropZoneRef = useRef< HTMLDivElement >( null );
	const conversationViewRef = useRef< HTMLDivElement >( null );
	const messagesRef = useRef< MessageType[] >( messages );
	const pendingImagesRef = useRef< WorkspaceDollyPendingImage[] >( pendingImages );
	const previewStateRef = useRef< WorkspacePreviewState >( previewState );
	const conversationIdRef = useRef( selectedConversationId );
	const remoteChatIdRef = useRef( initialConversationState.remoteChatId );
	const serverHydrationDisabledRef = useRef(
		Boolean( initialConversationState.serverHydrationDisabled )
	);
	const preserveLastUpdatedOnNextWriteRef = useRef( false );
	const isAssistantThinkingRef = useRef( isAssistantThinking );
	const hydratedTargetKeysRef = useRef( new Set< string >() );
	const locallyStartedTurnConversationIdsRef = useRef( new Set< string >() );
	const targetActivityKey = getWorkspaceDollyTargetActivityKey( {
		workspaceId: workspace.id,
		targetId: target.id,
		siteId: target.site.id,
	} );
	const hasActiveAssistantTurn = useWorkspaceDollyConversationTurn( selectedConversationId );
	const isCurrentSessionAssistantThinking = isAssistantThinking || hasActiveAssistantTurn;
	const hadActiveAssistantTurnRef = useRef( hasActiveAssistantTurn );
	const previousMessageCountRef = useRef( messages.length );
	const isAtLatestMessageRef = useRef( true );

	const conversationsForTarget = useMemo( () => {
		void conversationListVersion;
		return getWorkspaceDollyConversationsForTarget( targetDescriptor );
	}, [ conversationListVersion, targetDescriptor ] );
	const selectedConversationForTarget =
		conversationsForTarget.find( ( conversation ) => conversation.id === selectedConversationId ) ??
		conversationsForTarget[ 0 ];
	const showConversationControls = shouldShowConversationControls(
		conversationsForTarget,
		selectedConversationForTarget
	);
	const siteAssociation = useMemo(
		() =>
			createWorkspaceDollySiteAssociationContext( {
				workspaceId: workspace.id,
				targetId: target.id,
				site: target.site,
			} ),
		[ target.id, target.site, workspace.id ]
	);
	const hasFailedMessage = messages.some( ( message ) => message.failedMessage );
	const failedMessageContent = messages.find( ( message ) => message.failedMessage )?.content;

	const refreshConversationList = useCallback( () => {
		setConversationListVersion( ( version ) => version + 1 );
	}, [ setConversationListVersion ] );

	const clearPendingImages = useCallback( () => {
		setPendingImages( ( currentImages ) => {
			revokeWorkspaceDollyPendingImageUrls( currentImages );
			return [];
		} );
		setImageUploadError( undefined );
	}, [ setImageUploadError, setPendingImages ] );

	const removePendingImage = useCallback(
		( image: UploadedImage ) => {
			setPendingImages( ( currentImages ) => {
				const removedImage = currentImages.find( ( currentImage ) => currentImage.id === image.id );
				if ( removedImage ) {
					revokeWorkspaceDollyPendingImageUrls( [ removedImage ] );
				}
				return currentImages.filter( ( currentImage ) => currentImage.id !== image.id );
			} );
		},
		[ setPendingImages ]
	);

	const addPendingImages = useCallback(
		( files: File[] ) => {
			const validFiles = files.filter( ( file ) =>
				WORKSPACE_DOLLY_IMAGE_FILE_TYPES.includes( file.type )
			);
			const validSizedFiles = validFiles.filter(
				( file ) => file.size <= WORKSPACE_DOLLY_IMAGE_MAX_FILE_SIZE
			);
			const remainingSlots = Math.max( WORKSPACE_DOLLY_IMAGE_MAX_FILES - pendingImages.length, 0 );
			const filesToAdd = validSizedFiles.slice( 0, remainingSlots );

			if ( files.length !== validFiles.length ) {
				setImageUploadError( __( 'Only JPEG, PNG, GIF, or WebP images can be attached.' ) );
			} else if ( validFiles.length !== validSizedFiles.length ) {
				setImageUploadError( __( 'Images must be 10 MB or smaller.' ) );
			} else if ( validSizedFiles.length > filesToAdd.length ) {
				setImageUploadError(
					sprintf(
						__( 'You can attach up to %d images at a time.' ),
						WORKSPACE_DOLLY_IMAGE_MAX_FILES
					)
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
					dataUrl: await readWorkspaceDollyFileAsDataUrl( image.file ),
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
		[ pendingImages.length, setImageUploadError, setPendingImages ]
	);

	useEffect( () => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, [] );

	useEffect( () => {
		messagesRef.current = messages;
	}, [ messages ] );

	useEffect( () => {
		pendingImagesRef.current = pendingImages;
	}, [ pendingImages ] );

	useEffect( () => () => revokeWorkspaceDollyPendingImageUrls( pendingImagesRef.current ), [] );

	useEffect( () => {
		previewStateRef.current = previewState;
	}, [ previewState ] );

	useEffect( () => {
		isAssistantThinkingRef.current = isCurrentSessionAssistantThinking;
	}, [ isCurrentSessionAssistantThinking ] );

	useEffect( () => {
		setWorkspaceDollyTargetUnread(
			{ workspaceId: workspace.id, targetId: target.id, siteId: target.site.id },
			false
		);
	}, [ target.id, target.site.id, workspace.id ] );

	useEffect( () => {
		const cachedConversationState = getCachedWorkspaceDollyConversationState(
			conversationIdRef.current
		);
		const preserveLastUpdated = preserveLastUpdatedOnNextWriteRef.current;
		preserveLastUpdatedOnNextWriteRef.current = false;

		writeWorkspaceDollyConversationState( {
			id: conversationIdRef.current,
			key: {
				workspaceId: workspace.id,
				targetId: target.id,
				siteId: target.site.id,
				agentId: 'dolly',
			},
			remoteChatId: remoteChatIdRef.current,
			serverHydrationDisabled: serverHydrationDisabledRef.current,
			input,
			messages,
			sessionId,
			lastUpdated:
				preserveLastUpdated && cachedConversationState
					? cachedConversationState.lastUpdated
					: Date.now(),
		} );
		refreshConversationList();
	}, [
		input,
		messages,
		refreshConversationList,
		sessionId,
		target.id,
		target.site.id,
		workspace.id,
	] );

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

	const openPreview = useCallback(
		( pathOrUrl = '/', options = {} ) => {
			onUpdatePreviewState(
				getNextWorkspaceDollyPreviewState( previewStateRef.current, pathOrUrl, options )
			);
		},
		[ onUpdatePreviewState ]
	);

	const openChatLinkInPreview = useCallback(
		( rawHref?: string ) => {
			const href = rawHref?.trim();
			if ( ! href || href === 'agenttic:incomplete-link' || href.startsWith( '#' ) ) {
				return false;
			}

			const hasNonHttpScheme = /^[a-z][a-z0-9+.-]*:/i.test( href ) && ! /^https?:/i.test( href );
			if ( hasNonHttpScheme ) {
				return false;
			}

			const normalizedUrl = normalizeWorkspaceDollyPreviewUrl( target.site.url, href );
			if ( normalizedUrl === 'about:blank' ) {
				return false;
			}

			openPreview( normalizedUrl );
			return true;
		},
		[ openPreview, target.site.url ]
	);

	const dollyMessageRenderer = useMemo(
		() =>
			createMessageRenderer( {
				components: {
					a: ( { href, children, className, ...props } ) => {
						const linkHref = typeof href === 'string' ? href : undefined;
						const openLinkInPreview = ( event: MouseEvent< HTMLAnchorElement > ) => {
							if ( openChatLinkInPreview( linkHref ) ) {
								event.preventDefault();
								event.stopPropagation();
							}
						};

						if ( isWorkspaceDollyRenderableImageLinkUrl( linkHref, target.site.url ) ) {
							return (
								<a
									{ ...props }
									href={ linkHref }
									className={ cx(
										className,
										'block cursor-pointer underline-offset-2 hover:underline'
									) }
									onClick={ openLinkInPreview }
								>
									<img
										src={ linkHref }
										alt={ typeof children === 'string' ? children : __( 'Image attachment' ) }
										loading="lazy"
										className={ WORKSPACE_DOLLY_IMAGE_PREVIEW_CLASS_NAME }
										style={ WORKSPACE_DOLLY_IMAGE_PREVIEW_STYLE }
									/>
								</a>
							);
						}

						return (
							<a
								{ ...props }
								href={ href }
								className={ cx( className, 'cursor-pointer underline-offset-2 hover:underline' ) }
								onClick={ openLinkInPreview }
							>
								{ children }
							</a>
						);
					},
					img: ( { src, alt, className, style, ...props } ) => {
						const imageSrc = typeof src === 'string' ? src : undefined;
						if ( isWorkspaceDollyRenderableImageUrl( imageSrc, target.site.url ) ) {
							return (
								<img
									{ ...props }
									src={ imageSrc }
									alt={ alt ?? '' }
									className={ cx( WORKSPACE_DOLLY_IMAGE_PREVIEW_CLASS_NAME, className ) }
									style={ {
										...WORKSPACE_DOLLY_IMAGE_PREVIEW_STYLE,
										...style,
									} }
								/>
							);
						}

						if ( ! imageSrc ) {
							return null;
						}

						return (
							<a
								href={ imageSrc }
								className={ cx( className, 'cursor-pointer underline-offset-2 hover:underline' ) }
								onClick={ ( event ) => {
									if ( openChatLinkInPreview( imageSrc ) ) {
										event.preventDefault();
										event.stopPropagation();
									}
								} }
							>
								{ alt || __( 'Image attachment' ) }
							</a>
						);
					},
				},
			} ),
		[ openChatLinkInPreview, target.site.url ]
	);

	const isVisibleConversation = useCallback( ( targetConversationId: string ) => {
		return isMountedRef.current && conversationIdRef.current === targetConversationId;
	}, [] );

	const writeCachedConversationState = useCallback(
		(
			targetConversationId: string,
			updater: (
				currentConversationState: WorkspaceDollyConversationState
			) => WorkspaceDollyConversationState
		) => {
			const currentConversationState = getCachedWorkspaceDollyConversationState(
				targetConversationId
			) ?? {
				...getWorkspaceDollyConversationState( targetDescriptor ),
				id: targetConversationId,
			};
			const nextConversationState = {
				...updater( currentConversationState ),
				id: targetConversationId,
				lastUpdated: Date.now(),
			};
			writeWorkspaceDollyConversationState( nextConversationState );
			refreshConversationList();
			return nextConversationState;
		},
		[ refreshConversationList, targetDescriptor ]
	);

	const applyVisibleConversationState = useCallback(
		( targetConversationId: string, nextConversationState: WorkspaceDollyConversationState ) => {
			if ( ! isVisibleConversation( targetConversationId ) ) {
				return;
			}

			conversationIdRef.current = nextConversationState.id;
			setSelectedConversationId( nextConversationState.id );
			remoteChatIdRef.current = nextConversationState.remoteChatId;
			serverHydrationDisabledRef.current = Boolean( nextConversationState.serverHydrationDisabled );
			messagesRef.current = nextConversationState.messages;
			setInput( nextConversationState.input );
			setMessages( nextConversationState.messages );
			setSessionId( nextConversationState.sessionId );
		},
		[ isVisibleConversation, setInput, setMessages, setSelectedConversationId, setSessionId ]
	);

	const applySelectedConversationState = useCallback(
		( nextConversationState: WorkspaceDollyConversationState ) => {
			conversationIdRef.current = nextConversationState.id;
			setSelectedConversationId( nextConversationState.id );
			remoteChatIdRef.current = nextConversationState.remoteChatId;
			serverHydrationDisabledRef.current = Boolean( nextConversationState.serverHydrationDisabled );
			messagesRef.current = nextConversationState.messages;
			setInput( nextConversationState.input );
			setMessages( nextConversationState.messages );
			setOptimisticMessageImages( {} );
			setSessionId( nextConversationState.sessionId );
			setIsAssistantThinking( Boolean( getWorkspaceDollyTurn( nextConversationState.id ) ) );
			setErrorMessage( undefined );
			clearPendingImages();
			refreshConversationList();
		},
		[
			clearPendingImages,
			refreshConversationList,
			setInput,
			setIsAssistantThinking,
			setMessages,
			setSelectedConversationId,
			setSessionId,
			setOptimisticMessageImages,
			setErrorMessage,
		]
	);

	useEffect( () => {
		if (
			! isAuthenticated ||
			isOffline ||
			! client ||
			typeof ( client.req as { get?: unknown } ).get !== 'function' ||
			hydratedTargetKeysRef.current.has( targetActivityKey )
		) {
			return;
		}

		hydratedTargetKeysRef.current.add( targetActivityKey );
		let isCurrentHydration = true;

		void ( async () => {
			try {
				const cachedConversationState = getWorkspaceDollyConversationState( targetDescriptor );
				const hydratedConversationStates = await hydrateWorkspaceDollyConversationStates(
					client,
					targetDescriptor,
					cachedConversationState.sessionId
				);

				if (
					hydratedConversationStates.length === 0 ||
					! isCurrentHydration ||
					! isMountedRef.current ||
					isAssistantThinkingRef.current
				) {
					return;
				}

				hydratedConversationStates.forEach( ( hydratedConversationState ) => {
					mergeWorkspaceDollyConversationState(
						{
							...hydratedConversationState,
							serverHydrationDisabled: false,
						},
						{ selectIfEmpty: true }
					);
				} );
				refreshConversationList();

				const nextConversationState = getWorkspaceDollyConversationState( targetDescriptor );
				applySelectedConversationState( nextConversationState );
			} catch ( error ) {
				console.error( error );
			}
		} )();

		return () => {
			isCurrentHydration = false;
		};
	}, [
		applySelectedConversationState,
		client,
		isAuthenticated,
		isOffline,
		refreshConversationList,
		targetActivityKey,
		targetDescriptor,
	] );

	useEffect( () => {
		const hadActiveAssistantTurn = hadActiveAssistantTurnRef.current;
		hadActiveAssistantTurnRef.current = hasActiveAssistantTurn;

		if ( ! hadActiveAssistantTurn || hasActiveAssistantTurn || isAssistantThinking ) {
			return;
		}

		if ( locallyStartedTurnConversationIdsRef.current.delete( selectedConversationId ) ) {
			return;
		}

		const nextConversationState = getWorkspaceDollyConversationState( targetDescriptor );
		applyVisibleConversationState( nextConversationState.id, nextConversationState );
		setIsAssistantThinking( false );
	}, [
		applyVisibleConversationState,
		hasActiveAssistantTurn,
		isAssistantThinking,
		selectedConversationId,
		targetDescriptor,
	] );

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

	const createDollyToolProviderForConversation = useCallback(
		( { targetPreviewState }: { targetPreviewState: WorkspacePreviewState } ): ToolProvider => ( {
			getAbilities: async () =>
				createWorkspaceDollyPreviewAbilities( {
					site: target.site,
					previewState: targetPreviewState,
					openPreview: ( pathOrUrl = '/', options ) => {
						onUpdatePreviewState(
							getNextWorkspaceDollyPreviewState( previewStateRef.current, pathOrUrl, options )
						);
					},
				} ),
		} ),
		[ onUpdatePreviewState, target.site ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			const imagesToSend = isRetry ? [] : pendingImages;
			const targetConversationId = selectedConversationId;
			if (
				( ! trimmedMessage && imagesToSend.length === 0 ) ||
				! client ||
				isCurrentSessionAssistantThinking ||
				getWorkspaceDollyTurn( targetConversationId )
			) {
				return;
			}

			if ( ! isRetry ) {
				setInput( '' );
			}
			setErrorMessage( undefined );
			setImageUploadError( undefined );

			const targetPreviewState = previewStateRef.current;
			const targetPreviewContext = createWorkspaceDollyPreviewContext(
				target.site.id,
				target.site.url,
				targetPreviewState
			);
			const targetSiteAssociation = siteAssociation;
			const targetSessionId = sessionId;
			const targetRemoteChatId = remoteChatIdRef.current;
			const targetServerHydrationDisabled = serverHydrationDisabledRef.current;
			const startingMessages: MessageType[] = messagesRef.current.map( ( currentMessage ) => ( {
				...currentMessage,
				failedMessage: false,
			} ) );
			const messageToSend =
				trimmedMessage ||
				( imagesToSend.length > 0 ? createWorkspaceDollyImagePrompt( imagesToSend.length ) : '' );
			const newMessageId = isRetry ? startingMessages.length - 1 : startingMessages.length;
			const optimisticImagesPromise = createWorkspaceDollyPendingVisibleImages( imagesToSend );
			const abortController = new AbortController();
			const toolProvider = createDollyToolProviderForConversation( {
				targetPreviewState,
			} );

			if ( ! isRetry && imagesToSend.length > 0 ) {
				setPendingImages( [] );
				revokeWorkspaceDollyPendingImageUrls( imagesToSend );
			}

			startWorkspaceDollyTurn( {
				conversationId: targetConversationId,
				workspaceId: workspace.id,
				targetId: target.id,
				siteId: target.site.id,
				abortController,
			} );
			locallyStartedTurnConversationIdsRef.current.add( targetConversationId );
			if ( isVisibleConversation( targetConversationId ) ) {
				setIsAssistantThinking( true );
			}

			void ( async () => {
				let optimisticMessage: MessageType | undefined;
				let messagesForResponse: MessageType[] = startingMessages;
				let uploadedImages: WorkspaceDollyUploadedImage[] = [];
				try {
					const optimisticImages = await optimisticImagesPromise;
					const nextOptimisticMessage = generateMessage( messageToSend, 'user', newMessageId );
					optimisticMessage = nextOptimisticMessage;
					if ( optimisticImages.length > 0 && isVisibleConversation( targetConversationId ) ) {
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
					const conversationWithUserMessage = writeCachedConversationState(
						targetConversationId,
						( currentConversationState ) => ( {
							...currentConversationState,
							remoteChatId: targetRemoteChatId,
							serverHydrationDisabled: targetServerHydrationDisabled,
							input: '',
							messages: messagesForResponse,
							sessionId: targetSessionId,
						} )
					);
					applyVisibleConversationState( targetConversationId, conversationWithUserMessage );

					uploadedImages = await uploadWorkspaceDollyImages(
						target.site.id,
						imagesToSend,
						abortController.signal
					);
					if ( uploadedImages.length > 0 ) {
						const uploadedVisibleImages = uploadedImages.map( ( image ) => ( {
							name: image.name,
							url: image.url,
						} ) );
						const visibleMessage = createWorkspaceDollyVisibleMessage(
							messageToSend,
							uploadedVisibleImages,
							imagesToSend.length
						);
						messagesForResponse = messagesForResponse.map( ( currentMessage ) =>
							currentMessage.id === optimisticMessage?.id
								? { ...currentMessage, content: visibleMessage }
								: currentMessage
						);
						const conversationWithUploadedImages = writeCachedConversationState(
							targetConversationId,
							( currentConversationState ) => ( {
								...currentConversationState,
								messages: messagesForResponse,
							} )
						);
						applyVisibleConversationState( targetConversationId, conversationWithUploadedImages );
					}

					const response = await sendWorkspaceDollyMessage( {
						abortSignal: abortController.signal,
						message: messageToSend,
						uploadedImages,
						previewContext: targetPreviewContext,
						siteAssociation: targetSiteAssociation,
						selectedSite: target.site,
						sessionId: targetSessionId,
						workspaceId: workspace.id,
						targetId: target.id,
						toolProvider,
					} );

					const responseMessages: MessageType[] = [ ...messagesForResponse ];
					const hasAssistantReply = Boolean( response.text.trim() );
					if ( hasAssistantReply ) {
						responseMessages.push(
							generateMessage( response.text, 'assistant', responseMessages.length )
						);
					}

					const nextConversationState = writeCachedConversationState(
						targetConversationId,
						( currentConversationState ) => ( {
							...currentConversationState,
							messages: responseMessages,
							sessionId: response.sessionId ?? targetSessionId,
						} )
					);
					applyVisibleConversationState( targetConversationId, nextConversationState );
					if ( hasAssistantReply ) {
						setWorkspaceDollyTargetUnread(
							{ workspaceId: workspace.id, targetId: target.id, siteId: target.site.id },
							! isVisibleConversation( targetConversationId )
						);
					}
				} catch ( error ) {
					if ( isWorkspaceDollyRequestAbortError( error ) || abortController.signal.aborted ) {
						return;
					}
					console.error( error );
					const nextErrorMessage = getWorkspaceDollyErrorMessage( error );
					const nextMessages = optimisticMessage
						? messagesForResponse.map( ( currentMessage ) =>
								currentMessage.id === optimisticMessage?.id
									? { ...currentMessage, failedMessage: true }
									: currentMessage
						  )
						: messagesForResponse;
					const nextConversationState = writeCachedConversationState(
						targetConversationId,
						( currentConversationState ) => ( {
							...currentConversationState,
							input: isRetry ? currentConversationState.input : chatMessage,
							messages: nextMessages,
						} )
					);
					if ( isVisibleConversation( targetConversationId ) ) {
						setErrorMessage( nextErrorMessage );
						setImageUploadError( nextErrorMessage );
					}
					applyVisibleConversationState( targetConversationId, nextConversationState );
				} finally {
					finishWorkspaceDollyTurn( targetConversationId, abortController );
					if ( isVisibleConversation( targetConversationId ) ) {
						setIsAssistantThinking( false );
					}
				}
			} )();
		},
		[
			applyVisibleConversationState,
			client,
			createDollyToolProviderForConversation,
			isCurrentSessionAssistantThinking,
			isVisibleConversation,
			pendingImages,
			selectedConversationId,
			sessionId,
			siteAssociation,
			target.id,
			target.site,
			workspace.id,
			writeCachedConversationState,
		]
	);

	const startNewConversation = useCallback( () => {
		const nextConversationState = createNewWorkspaceDollyConversation( targetDescriptor );
		applySelectedConversationState( nextConversationState );
	}, [ applySelectedConversationState, targetDescriptor ] );

	const selectConversation = useCallback(
		( conversationId: string ) => {
			const nextConversationState = getCachedWorkspaceDollyConversationState( conversationId );
			if ( ! nextConversationState ) {
				return;
			}

			preserveLastUpdatedOnNextWriteRef.current = true;
			setSelectedWorkspaceDollyConversationId( targetDescriptor, conversationId );
			applySelectedConversationState( nextConversationState );
		},
		[ applySelectedConversationState, targetDescriptor ]
	);

	const deleteConversation = useCallback(
		( conversationId: string ) => {
			if ( getWorkspaceDollyTurn( conversationId ) ) {
				return;
			}

			const nextConversationState = deleteWorkspaceDollyConversation(
				conversationId,
				targetDescriptor
			);
			applySelectedConversationState( nextConversationState );
		},
		[ applySelectedConversationState, targetDescriptor ]
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
							type: 'text' as const,
							text: optimisticImageAttachment?.text ?? message.content,
						},
						...( optimisticImageAttachment?.images.length
							? [
									{
										type: 'component' as const,
										component: WorkspaceDollyOptimisticImages,
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
		abortWorkspaceDollyTurn( selectedConversationId );
	}, [ selectedConversationId ] );

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

		if ( errorMessage ) {
			return {
				message: errorMessage,
				status: 'error',
				dismissible: true,
				onDismiss: () => setErrorMessage( undefined ),
			};
		}

		return undefined;
	}, [
		errorMessage,
		hasFailedMessage,
		imageUploadError,
		isOffline,
		retryFailedMessage,
		setErrorMessage,
		setImageUploadError,
	] );

	const isInputUnavailable = isOffline || ! isAuthenticated || ! client;
	const isInputDisabled = isInputUnavailable && ! isCurrentSessionAssistantThinking;
	const isInputActionDisabled = isInputUnavailable || isCurrentSessionAssistantThinking;
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
			...( showConversationControls
				? [
						{
							id: 'chat-options',
							icon: <Icon icon={ moreVertical } size={ 18 } />,
							onClick: ( event?: MouseEvent< HTMLButtonElement > ) => {
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
		],
		[ isInputActionDisabled, showConversationControls ]
	);
	const dollyEmptyView = useMemo( () => <WorkspaceDollyEmptyView />, [] );

	if ( ! isAuthenticated ) {
		return (
			<div
				data-testid="assistant-chat"
				className="flex min-h-full items-start overflow-y-auto p-8 pb-2"
			>
				<div className="mt-auto w-full">
					{ isOffline ? (
						<OfflineModeView />
					) : (
						<UnauthenticatedView onAuthenticate={ authenticate } />
					) }
				</div>
			</div>
		);
	}

	return (
		<div
			data-testid="assistant-chat"
			className="agenttic dolly-agenttic-chat h-full min-h-0 overflow-hidden"
		>
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
							acceptedFileTypes={ WORKSPACE_DOLLY_IMAGE_FILE_TYPES }
							maxFileSize={ WORKSPACE_DOLLY_IMAGE_MAX_FILE_SIZE }
							maxFiles={ WORKSPACE_DOLLY_IMAGE_MAX_FILES }
							dropZoneRef={ dollyDropZoneRef }
							onError={ setImageUploadError }
						/>
						<AgentUI.Input
							disabled={ isInputDisabled ? true : pendingImages.length > 0 ? false : undefined }
							customActions={ dollyInputActions }
							actionOrder="before-submit"
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
							Boolean( getWorkspaceDollyTurn( conversationId ) )
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
	);
}
