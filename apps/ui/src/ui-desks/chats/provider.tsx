import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateSession } from '@/data/queries/use-sessions';
import {
	ChatsContext,
	type ChatPromptRequest,
	type ChatsProviderProps,
	type PendingChatPrompt,
} from './context';
import { validateChatsSearch, type ChatsSearch } from './search';

function useChatsSearch() {
	const search = validateChatsSearch( useSearch( { strict: false } ) as Record< string, unknown > );
	const navigate = useNavigate();
	const open = search.chats === true;
	const createChatRequestId = search.newChat ?? 0;

	const setOpen = useCallback(
		( nextOpen: boolean ) => {
			void navigate( {
				to: '.',
				search: ( previous: ChatsSearch ) => ( {
					...previous,
					chats: nextOpen ? true : undefined,
				} ),
			} );
		},
		[ navigate ]
	);

	return { open, setOpen, createChatRequestId };
}

function createPendingPromptId() {
	return `chat-${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 8 ) }`;
}

export function ChatsProvider( { siteId, children }: ChatsProviderProps ) {
	const { open, setOpen, createChatRequestId } = useChatsSearch();
	const createSession = useCreateSession();
	const lastCreateChatRequestId = useRef( createChatRequestId );
	const [ selectedSessionId, setSelectedSessionId ] = useState< string | undefined >( undefined );
	const [ expanded, setExpanded ] = useState( false );
	const [ autoFocusSessionId, setAutoFocusSessionId ] = useState< string | undefined >( undefined );
	const [ pendingPrompt, setPendingPrompt ] = useState< PendingChatPrompt | undefined >(
		undefined
	);

	const selectSession = useCallback( ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( undefined );
	}, [] );

	const switchSession = useCallback( ( sessionId: string ) => {
		setSelectedSessionId( sessionId );
		setExpanded( true );
		setAutoFocusSessionId( sessionId );
	}, [] );

	const clearSelection = useCallback( () => {
		setSelectedSessionId( undefined );
		setExpanded( false );
		setAutoFocusSessionId( undefined );
	}, [] );

	const startNewChat = useCallback( async () => {
		const session = await createSession.mutateAsync( siteId );
		setSelectedSessionId( session.id );
		setExpanded( true );
		setAutoFocusSessionId( session.id );
		setOpen( true );
	}, [ createSession, setOpen, siteId ] );

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
			setOpen( true );
		},
		[ createSession, setOpen, siteId ]
	);

	const consumePendingPrompt = useCallback( ( promptId: string ) => {
		setPendingPrompt( ( current ) => ( current?.id === promptId ? undefined : current ) );
	}, [] );

	useEffect( () => {
		if ( createChatRequestId === lastCreateChatRequestId.current ) {
			return;
		}

		lastCreateChatRequestId.current = createChatRequestId;
		void startNewChat();
	}, [ createChatRequestId, startNewChat ] );

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
				selectSession,
				switchSession,
				clearSelection,
				startNewChat,
				startChatWithPrompt,
				consumePendingPrompt,
			} }
		>
			{ children }
		</ChatsContext.Provider>
	);
}
