import { useNavigate, useSearch } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useCreateSession } from '@/data/queries/use-sessions';
import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../components';
import {
	ChatsContext,
	type ChatPromptRequest,
	type ComposerWidgetDragPreview,
	type ComposerWidgetAttachmentRequest,
	type ChatsProviderProps,
	type PendingChatPrompt,
} from './context';
import { validateChatsSearch, type ChatsSearch } from './search';
import type { DeskWidget } from '@/ui-desks/widgets/types';

interface PendingPlacementSwitch {
	sessionId: string;
	siteId: string;
	siteName: string;
}

function useChatsSearch() {
	const search = validateChatsSearch( useSearch( { strict: false } ) as Record< string, unknown > );
	const navigate = useNavigate();
	const open = search.chats === true;
	const createChatRequestId = search.newChat ?? 0;
	const routeSessionId = search.session;

	const setOpen = useCallback(
		( nextOpen: boolean ) => {
			void navigate( {
				to: '.',
				search: ( previous: ChatsSearch ) => ( {
					...previous,
					chats: nextOpen ? true : undefined,
					session: nextOpen ? previous.session : undefined,
				} ),
			} );
		},
		[ navigate ]
	);

	return { open, setOpen, createChatRequestId, routeSessionId, navigate };
}

function createPendingPromptId() {
	return `chat-${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 8 ) }`;
}

function createComposerWidgetAttachmentRequestId() {
	return `widgets-${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 8 ) }`;
}

export function ChatsProvider( { siteId, children }: ChatsProviderProps ) {
	const { open, setOpen, createChatRequestId, routeSessionId, navigate } = useChatsSearch();
	const connector = useConnector();
	const createSession = useCreateSession();
	const { data: authUser, refetch: refetchAuthUser } = useAuthUser();
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const [ pendingPrompt, setPendingPrompt ] = useState< PendingChatPrompt | undefined >(
		undefined
	);
	const [ authRequiredPrompt, setAuthRequiredPrompt ] = useState< ChatPromptRequest | undefined >(
		undefined
	);
	const [ composerWidgetAttachmentRequest, setComposerWidgetAttachmentRequest ] = useState<
		ComposerWidgetAttachmentRequest | undefined
	>( undefined );
	const [ composerWidgetDragPreview, setComposerWidgetDragPreview ] = useState<
		ComposerWidgetDragPreview | undefined
	>( undefined );
	const [ isComposerWidgetDragTarget, setComposerWidgetDragTarget ] = useState( false );
	const [ pendingPlacementSwitch, setPendingPlacementSwitch ] = useState<
		PendingPlacementSwitch | undefined
	>( undefined );

	const setRouteSession = useCallback(
		( sessionId: string | undefined ) => {
			void navigate( {
				to: '.',
				search: ( previous: ChatsSearch ) => ( {
					...previous,
					chats: sessionId ? true : previous.chats,
					session: sessionId,
				} ),
			} );
		},
		[ navigate ]
	);

	const selectSession = useCallback(
		( sessionId: string ) => {
			setSelectedSessionId( sessionId );
			setExpanded( true );
			setAutoFocusSessionId( undefined );
			setAuthRequiredPrompt( undefined );
			setRouteSession( sessionId );
		},
		[ setRouteSession ]
	);

	const switchSession = useCallback(
		( sessionId: string ) => {
			setSelectedSessionId( sessionId );
			setExpanded( true );
			setAutoFocusSessionId( sessionId );
			setAuthRequiredPrompt( undefined );
			setRouteSession( sessionId );
		},
		[ setRouteSession ]
	);

	const clearSelection = useCallback( () => {
		setSelectedSessionId( undefined );
		setExpanded( false );
		setAutoFocusSessionId( undefined );
		setAuthRequiredPrompt( undefined );
		setRouteSession( undefined );
	}, [ setRouteSession ] );

	const closeChatSidebar = useCallback( () => {
		setSelectedSessionId( undefined );
		setExpanded( false );
		setAutoFocusSessionId( undefined );
		setPendingPlacementSwitch( undefined );
		setAuthRequiredPrompt( undefined );
		void navigate( {
			to: '.',
			search: ( previous: ChatsSearch ) => ( {
				...previous,
				chats: undefined,
				session: undefined,
			} ),
		} );
	}, [ navigate ] );

	const showAuthRequired = useCallback(
		( prompt?: ChatPromptRequest ) => {
			setSelectedSessionId( undefined );
			setExpanded( true );
			setAutoFocusSessionId( undefined );
			setAuthRequiredPrompt( prompt );
			void navigate( {
				to: '.',
				search: ( previous: ChatsSearch ) => ( {
					...previous,
					chats: true,
					session: undefined,
				} ),
			} );
		},
		[ navigate ]
	);

	const ensureAuthenticatedForChat = useCallback( async () => {
		if ( authUser ) {
			return true;
		}

		const result = await refetchAuthUser();
		return !! result.data;
	}, [ authUser, refetchAuthUser ] );

	const startNewChat = useCallback( async () => {
		if ( ! ( await ensureAuthenticatedForChat() ) ) {
			showAuthRequired();
			return;
		}

		setAuthRequiredPrompt( undefined );
		const session = await createSession.mutateAsync( siteId );
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
		setRouteSession( session.id );
		setOpen( true );
	}, [
		createSession,
		ensureAuthenticatedForChat,
		setOpen,
		setRouteSession,
		showAuthRequired,
		siteId,
	] );

	const startChatWithPrompt = useCallback(
		async ( request: ChatPromptRequest ) => {
			if ( ! ( await ensureAuthenticatedForChat() ) ) {
				showAuthRequired( request );
				return '';
			}

			setAuthRequiredPrompt( undefined );
			const session = await createSession.mutateAsync( siteId );
			setSelectedSessionId( session.id );
			setExpanded( true );
			setAutoFocusSessionId( undefined );
			setPendingPrompt( {
				id: createPendingPromptId(),
				sessionId: session.id,
				prompt: request.prompt,
				displayMessage: request.displayMessage ?? request.prompt,
			} );
			setRouteSession( session.id );
			setOpen( true );
			return session.id;
		},
		[
			createSession,
			ensureAuthenticatedForChat,
			setOpen,
			setRouteSession,
			showAuthRequired,
			siteId,
		]
	);

	const consumePendingPrompt = useCallback( ( promptId: string ) => {
		setPendingPrompt( ( current ) => ( current?.id === promptId ? undefined : current ) );
	}, [] );

	const attachWidgetsToComposer = useCallback(
		( widgets: DeskWidget[] ) => {
			if ( ! selectedSessionId || widgets.length === 0 ) {
				return;
			}

			setComposerWidgetAttachmentRequest( {
				id: createComposerWidgetAttachmentRequestId(),
				sessionId: selectedSessionId,
				widgets,
			} );
		},
		[ selectedSessionId ]
	);

	const consumeComposerWidgetAttachmentRequest = useCallback( ( requestId: string ) => {
		setComposerWidgetAttachmentRequest( ( current ) =>
			current?.id === requestId ? undefined : current
		);
	}, [] );

	useEffect( () => {
		if ( createChatRequestId === lastCreateChatRequestId.current ) {
			return;
		}

		lastCreateChatRequestId.current = createChatRequestId;
		void startNewChat();
	}, [ createChatRequestId, startNewChat ] );

	useEffect( () => {
		if ( ! routeSessionId ) {
			return;
		}
		setSelectedSessionId( routeSessionId );
		setExpanded( true );
		setAutoFocusSessionId( undefined );
		setOpen( true );
	}, [ routeSessionId, setOpen ] );

	useEffect( () => {
		return connector.onSessionPlacementUpdated( ( event ) => {
			if ( event.sessionId !== selectedSessionId ) {
				return;
			}
			if ( event.placement.siteId === siteId ) {
				return;
			}
			setPendingPlacementSwitch( {
				sessionId: event.sessionId,
				siteId: event.placement.siteId,
				siteName: event.placement.siteName,
			} );
		} );
	}, [ connector, selectedSessionId, siteId ] );

	useEffect( () => {
		if ( pendingPlacementSwitch?.siteId === siteId ) {
			setPendingPlacementSwitch( undefined );
		}
	}, [ pendingPlacementSwitch?.siteId, siteId ] );

	useEffect( () => {
		if (
			pendingPlacementSwitch &&
			selectedSessionId &&
			pendingPlacementSwitch.sessionId !== selectedSessionId
		) {
			setPendingPlacementSwitch( undefined );
		}
	}, [ pendingPlacementSwitch, selectedSessionId ] );

	const confirmPlacementSwitch = useCallback( () => {
		if ( ! pendingPlacementSwitch ) {
			return;
		}
		setPendingPlacementSwitch( undefined );
		void navigate( {
			to: '/sites/$siteId',
			params: { siteId: pendingPlacementSwitch.siteId },
			search: ( previous: ChatsSearch ) => ( {
				...previous,
				chats: true,
				session: pendingPlacementSwitch.sessionId,
			} ),
		} );
	}, [ navigate, pendingPlacementSwitch ] );

	return (
		<ChatsContext.Provider
			value={ {
				open,
				setOpen,
				selectedSessionId,
				expanded,
				autoFocusSessionId,
				isCreatingChat: createSession.isPending,
				pendingPrompt,
				authRequiredPrompt,
				composerWidgetAttachmentRequest,
				composerWidgetDragPreview,
				isComposerWidgetDragTarget,
				selectSession,
				switchSession,
				clearSelection,
				startNewChat,
				startChatWithPrompt,
				consumePendingPrompt,
				attachWidgetsToComposer,
				consumeComposerWidgetAttachmentRequest,
				setComposerWidgetDragPreview,
				setComposerWidgetDragTarget,
			} }
		>
			{ children }
			{ pendingPlacementSwitch && (
				<Dialog
					ariaLabel={ __( 'Continue in the site desk?' ) }
					onClose={ closeChatSidebar }
					size="small"
				>
					<DialogHeader>
						<DialogTitle>{ __( 'Continue in the site desk?' ) }</DialogTitle>
					</DialogHeader>
					<DialogContent>
						<p>
							{ pendingPlacementSwitch.siteName
								? sprintf(
										__(
											'This chat is now connected to the site desk for %s. Switch desks to keep the conversation open, or stay here and close the chat sidebar.'
										),
										pendingPlacementSwitch.siteName
								  )
								: __(
										'This chat is now connected to another site desk. Switch desks to keep the conversation open, or stay here and close the chat sidebar.'
								  ) }
						</p>
					</DialogContent>
					<DialogFooter>
						<Button label={ __( 'Stay here' ) } onClick={ closeChatSidebar } variant="filled">
							{ __( 'Stay here' ) }
						</Button>
						<Button
							autoFocus
							label={ __( 'Switch desks' ) }
							onClick={ confirmPlacementSwitch }
							tone="primary"
							variant="filled"
						>
							{ __( 'Switch desks' ) }
						</Button>
					</DialogFooter>
				</Dialog>
			) }
		</ChatsContext.Provider>
	);
}
