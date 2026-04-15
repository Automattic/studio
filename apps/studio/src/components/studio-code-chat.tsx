import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AIInput } from 'src/components/ai-input';
import { ArrowIcon } from 'src/components/arrow-icon';
import { MessageThinking } from 'src/components/assistant-thinking';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { parseStudioCodeEvent, type ParsedAction } from './studio-code-event-parser';
import { StudioCodeMessage } from './studio-code-message';
import { StudioCodePermission } from './studio-code-permission';
import type { ChatMessage, PermissionRequest, ToolCallState } from './studio-code-types';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-types';

// ── LocalStorage persistence ──

const STORAGE_KEY = 'studio_code_chat';

interface PersistedState {
	messages: ChatMessage[];
	sessionId?: string;
}

function loadPersistedState( siteId: string ): PersistedState | null {
	try {
		const stored = localStorage.getItem( STORAGE_KEY );
		if ( ! stored ) {
			return null;
		}
		const allSites = JSON.parse( stored ) as Record< string, PersistedState >;
		return allSites[ siteId ] ?? null;
	} catch {
		return null;
	}
}

function savePersistedState( siteId: string, state: PersistedState ): void {
	try {
		const stored = localStorage.getItem( STORAGE_KEY );
		const allSites = stored ? ( JSON.parse( stored ) as Record< string, PersistedState > ) : {};
		allSites[ siteId ] = state;
		localStorage.setItem( STORAGE_KEY, JSON.stringify( allSites ) );
	} catch {
		// Ignore storage errors
	}
}

function clearPersistedState( siteId: string ): void {
	try {
		const stored = localStorage.getItem( STORAGE_KEY );
		if ( stored ) {
			const allSites = JSON.parse( stored ) as Record< string, PersistedState >;
			delete allSites[ siteId ];
			localStorage.setItem( STORAGE_KEY, JSON.stringify( allSites ) );
		}
	} catch {
		// Ignore storage errors
	}
}

// ── State & Reducer ──

type State = {
	messages: ChatMessage[];
	isStreaming: boolean;
	sessionId?: string;
	pendingPermission?: PermissionRequest;
	progressMessage?: string;
	lastUserMessage?: string;
};

type Action =
	| ParsedAction
	| { type: 'ADD_USER_MESSAGE'; text: string }
	| { type: 'PERMISSION_RESOLVED' }
	| { type: 'CLEAR' };

function updateLastAssistantMessage(
	messages: ChatMessage[],
	updater: ( msg: ChatMessage ) => ChatMessage
): ChatMessage[] {
	const updated = [ ...messages ];
	for ( let i = updated.length - 1; i >= 0; i-- ) {
		if ( updated[ i ].role === 'assistant' ) {
			updated[ i ] = updater( updated[ i ] );
			return updated;
		}
	}
	return updated;
}

function updateToolCall(
	toolCalls: ToolCallState[],
	id: string,
	updater: ( tc: ToolCallState ) => ToolCallState
): ToolCallState[] {
	return toolCalls.map( ( tc ) => ( tc.id === id ? updater( tc ) : tc ) );
}

function getLastAssistantMessage( messages: ChatMessage[] ): ChatMessage | undefined {
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		if ( messages[ i ].role === 'assistant' ) {
			return messages[ i ];
		}
	}
	return undefined;
}

const initialState: State = {
	messages: [],
	isStreaming: false,
};

function reducer( state: State, action: Action ): State {
	switch ( action.type ) {
		case 'ADD_USER_MESSAGE':
			return {
				...state,
				lastUserMessage: action.text,
				messages: [
					...state.messages,
					{
						id: crypto.randomUUID(),
						role: 'user',
						content: action.text,
						toolCalls: [],
						timestamp: Date.now(),
					},
				],
			};

		case 'START_ASSISTANT_MESSAGE':
			if ( state.isStreaming ) {
				return state;
			}
			return {
				...state,
				isStreaming: true,
				progressMessage: undefined,
				messages: [
					...state.messages,
					{
						id: crypto.randomUUID(),
						role: 'assistant',
						content: '',
						toolCalls: [],
						timestamp: Date.now(),
					},
				],
			};

		case 'APPEND_TEXT': {
			if ( ! getLastAssistantMessage( state.messages ) ) {
				return state;
			}
			return {
				...state,
				messages: updateLastAssistantMessage( state.messages, ( msg ) => ( {
					...msg,
					content: msg.content + action.text,
				} ) ),
			};
		}

		case 'TOOL_USE_START': {
			if ( ! getLastAssistantMessage( state.messages ) ) {
				return state;
			}
			return {
				...state,
				messages: updateLastAssistantMessage( state.messages, ( msg ) => ( {
					...msg,
					toolCalls: [
						...msg.toolCalls,
						{
							id: action.id,
							name: action.name,
							input: action.input,
							status: 'running',
						},
					],
				} ) ),
			};
		}

		case 'TOOL_RESULT': {
			if ( ! getLastAssistantMessage( state.messages ) ) {
				return state;
			}
			return {
				...state,
				messages: updateLastAssistantMessage( state.messages, ( msg ) => ( {
					...msg,
					toolCalls: updateToolCall( msg.toolCalls, action.id, ( tc ) => ( {
						...tc,
						status: action.isError ? 'error' : 'completed',
						output: action.output,
						isError: action.isError,
					} ) ),
				} ) ),
			};
		}

		case 'TURN_COMPLETE':
			return {
				...state,
				isStreaming: false,
				sessionId: action.sessionId,
				progressMessage: undefined,
			};

		case 'PERMISSION_REQUEST':
			return { ...state, pendingPermission: action.request };

		case 'PERMISSION_RESOLVED':
			return { ...state, pendingPermission: undefined };

		case 'SET_PROGRESS':
			if ( state.progressMessage === action.message ) {
				return state;
			}
			return { ...state, progressMessage: action.message };

		case 'ERROR':
			return {
				...state,
				isStreaming: false,
				progressMessage: undefined,
				messages: [
					...state.messages,
					{
						id: crypto.randomUUID(),
						role: 'assistant',
						content: `**${ __( 'Error' ) }:** ${ action.message }`,
						toolCalls: [],
						timestamp: Date.now(),
					},
				],
			};

		case 'CLEAR':
			return initialState;

		default:
			return state;
	}
}

// ── Component ──

interface StudioCodeChatProps {
	selectedSite: SiteDetails;
}

function initState( siteId: string ): State {
	const persisted = loadPersistedState( siteId );
	if ( persisted ) {
		return {
			...initialState,
			messages: persisted.messages,
			sessionId: persisted.sessionId,
		};
	}
	return initialState;
}

export function StudioCodeChat( { selectedSite }: StudioCodeChatProps ) {
	const [ state, dispatch ] = useReducer( reducer, selectedSite.id, initState );
	const [ inputValue, setInputValue ] = useState( '' );
	const messagesEndRef = useRef< HTMLDivElement >( null );
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();
	const showUnauthenticated = ! isAuthenticated && ! isOffline;

	// Persist messages and sessionId to localStorage
	useEffect( () => {
		if ( state.messages.length > 0 ) {
			savePersistedState( selectedSite.id, {
				messages: state.messages,
				sessionId: state.sessionId,
			} );
		}
	}, [ selectedSite.id, state.messages, state.sessionId ] );

	// Listen for IPC events from the CLI process
	const handleEvent = useCallback(
		( _event: unknown, data: { siteId: string; event: StudioCodeEvent } ) => {
			if ( data.siteId !== selectedSite.id ) {
				return;
			}
			const actions = parseStudioCodeEvent( data.event );
			for ( const action of actions ) {
				dispatch( action );
			}
		},
		[ selectedSite.id ]
	);

	useIpcListener( 'studio-code-event', handleEvent );

	// Auto-scroll on new messages
	useEffect( () => {
		messagesEndRef.current?.scrollIntoView( { behavior: 'smooth' } );
	}, [ state.messages, state.isStreaming ] );

	const handleSend = useCallback( () => {
		const text = inputValue.trim();
		if ( ! text || state.isStreaming ) {
			return;
		}

		dispatch( { type: 'ADD_USER_MESSAGE', text } );
		setInputValue( '' );

		void getIpcApi().studioCodeSendMessage(
			selectedSite.id,
			selectedSite.path,
			selectedSite.name,
			text
		);
	}, [ inputValue, state.isStreaming, selectedSite.id, selectedSite.path, selectedSite.name ] );

	const handleKeyDown = useCallback( () => {
		// Key handling is done by AIInput internally
	}, [] );

	const clearConversation = useCallback( () => {
		clearPersistedState( selectedSite.id );
		dispatch( { type: 'CLEAR' } );
	}, [ selectedSite.id ] );

	const handlePermissionRespond = useCallback(
		( id: string, answer: string ) => {
			dispatch( { type: 'PERMISSION_RESOLVED' } );
			const response: Record< string, string > = {};
			if ( state.pendingPermission ) {
				response[ state.pendingPermission.question ] = answer;
			}
			void getIpcApi().studioCodeRespondToPermission(
				selectedSite.id,
				selectedSite.path,
				selectedSite.name,
				state.lastUserMessage ?? 'Continue',
				response
			);
		},
		[
			selectedSite.id,
			selectedSite.path,
			selectedSite.name,
			state.pendingPermission,
			state.lastUserMessage,
		]
	);

	const isThinking = state.isStreaming && getLastAssistantMessage( state.messages )?.content === '';

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-y-auto px-4 pb-4">
				{ ! showUnauthenticated && (
					<>
						{ state.messages.map( ( message ) => (
							<StudioCodeMessage
								key={ message.id }
								message={ message }
								siteId={ selectedSite.id }
							/>
						) ) }
						{ isThinking && (
							<div className="flex justify-start ltr:md:mr-24 rtl:md:ml-24 mt-4">
								<div className="inline-block p-3 rounded border border-frame-border bg-frame/45">
									<MessageThinking />
									{ state.progressMessage && (
										<p className="text-xs text-frame-text-secondary mt-1 mb-0">
											{ state.progressMessage }
										</p>
									) }
								</div>
							</div>
						) }
						{ state.pendingPermission && (
							<StudioCodePermission
								permission={ state.pendingPermission }
								onRespond={ handlePermissionRespond }
							/>
						) }
					</>
				) }
				<div ref={ messagesEndRef } />
			</div>
			{ showUnauthenticated && (
				<div className="px-4 pb-4">
					<div className="p-3 rounded border border-frame-border bg-frame/45">
						<div className="mb-3 a8c-label-semibold">{ __( 'Hold up!' ) }</div>
						<div className="mb-1">
							{ __( 'You need to log in to your WordPress.com account to use Studio Code.' ) }
						</div>
						<div className="mb-1">
							{ createInterpolateElement(
								__( "If you don't have an account yet, <a>create one for free</a>." ),
								{
									a: <Button variant="link" onClick={ () => getIpcApi().authenticate( true ) } />,
								}
							) }
						</div>
						<div className="mb-3">{ __( 'Usage limits may change in the future.' ) }</div>
						<Button variant="primary" onClick={ authenticate }>
							{ __( 'Log in to WordPress.com' ) }
							<ArrowIcon />
						</Button>
					</div>
				</div>
			) }
			<div className="px-4 pb-4">
				<AIInput
					disabled={ showUnauthenticated }
					input={ inputValue }
					setInput={ setInputValue }
					handleSend={ handleSend }
					handleKeyDown={ handleKeyDown }
					clearConversation={ clearConversation }
					isAssistantThinking={ state.isStreaming }
					showTelexLink={ false }
				/>
			</div>
		</div>
	);
}
