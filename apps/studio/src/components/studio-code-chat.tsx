import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AIInput } from 'src/components/ai-input';
import { MessageThinking } from 'src/components/assistant-thinking';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { parseStudioCodeEvent, type ParsedAction } from './studio-code-event-parser';
import { StudioCodeMessage } from './studio-code-message';
import { StudioCodePermission } from './studio-code-permission';
import type { ChatMessage, PermissionRequest, ToolCallState } from './studio-code-types';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-types';

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

export function StudioCodeChat( { selectedSite }: StudioCodeChatProps ) {
	const [ state, dispatch ] = useReducer( reducer, initialState );
	const [ inputValue, setInputValue ] = useState( '' );
	const messagesEndRef = useRef< HTMLDivElement >( null );

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
		dispatch( { type: 'CLEAR' } );
	}, [] );

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
				{ state.messages.map( ( message ) => (
					<StudioCodeMessage key={ message.id } message={ message } siteId={ selectedSite.id } />
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
				<div ref={ messagesEndRef } />
			</div>
			<div className="px-4 pb-4">
				<AIInput
					disabled={ false }
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
