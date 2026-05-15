import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { useCreateSession } from '@/data/queries/use-sessions';
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
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const [ pendingPrompt, setPendingPrompt ] = useState< PendingChatPrompt | undefined >(
		undefined
	);
	const [ composerWidgetAttachmentRequest, setComposerWidgetAttachmentRequest ] = useState<
		ComposerWidgetAttachmentRequest | undefined
	>( undefined );
	const [ composerWidgetDragPreview, setComposerWidgetDragPreview ] = useState<
		ComposerWidgetDragPreview | undefined
	>( undefined );
	const [ isComposerWidgetDragTarget, setComposerWidgetDragTarget ] = useState( false );

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
			setRouteSession( sessionId );
		},
		[ setRouteSession ]
	);

	const switchSession = useCallback(
		( sessionId: string ) => {
			setSelectedSessionId( sessionId );
			setExpanded( true );
			setAutoFocusSessionId( sessionId );
			setRouteSession( sessionId );
		},
		[ setRouteSession ]
	);

	const clearSelection = useCallback( () => {
		setSelectedSessionId( undefined );
		setExpanded( false );
		setAutoFocusSessionId( undefined );
		setRouteSession( undefined );
	}, [ setRouteSession ] );

	const startNewChat = useCallback( async () => {
		const session = await createSession.mutateAsync( siteId );
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
		setRouteSession( session.id );
		setOpen( true );
	}, [ createSession, setOpen, setRouteSession, siteId ] );

	const startChatWithPrompt = useCallback(
		async ( request: ChatPromptRequest ) => {
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
		[ createSession, setOpen, setRouteSession, siteId ]
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
			void navigate( {
				to: '/sites/$siteId',
				params: { siteId: event.placement.siteId },
				search: ( previous: ChatsSearch ) => ( {
					...previous,
					chats: true,
					session: event.sessionId,
				} ),
			} );
		} );
	}, [ connector, navigate, selectedSessionId, siteId ] );

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
		</ChatsContext.Provider>
	);
}
