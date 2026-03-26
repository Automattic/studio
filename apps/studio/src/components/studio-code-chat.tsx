import { __ } from '@wordpress/i18n';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AIInput } from 'src/components/ai-input';
import { MessageThinking } from 'src/components/assistant-thinking';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { StudioCodeMessage } from './studio-code-message';
import { StudioCodePermission } from './studio-code-permission';
import type { ChatMessage, PermissionRequest, ToolCallState } from './studio-code-types';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-types';

// ── State & Reducer ──

type State = {
	messages: ChatMessage[];
	isStreaming: boolean;
	isProcessRunning: boolean;
	sessionId?: string;
	pendingPermission?: PermissionRequest;
	turnCost?: number;
};

type Action =
	| { type: 'PROCESS_STARTED' }
	| { type: 'PROCESS_STOPPED' }
	| { type: 'ADD_USER_MESSAGE'; text: string }
	| { type: 'START_ASSISTANT_MESSAGE' }
	| { type: 'APPEND_TEXT'; text: string }
	| { type: 'TEXT_COMPLETE' }
	| { type: 'TOOL_USE_START'; id: string; name: string; input: Record< string, unknown > }
	| { type: 'TOOL_RESULT'; id: string; output: string; isError: boolean }
	| { type: 'TURN_COMPLETE'; sessionId: string; cost: number }
	| { type: 'PERMISSION_REQUEST'; request: PermissionRequest }
	| { type: 'PERMISSION_RESOLVED' }
	| { type: 'ERROR'; message: string }
	| { type: 'CLEAR' };

function getLastAssistantMessage( messages: ChatMessage[] ): ChatMessage | undefined {
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		if ( messages[ i ].role === 'assistant' ) {
			return messages[ i ];
		}
	}
	return undefined;
}

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

const initialState: State = {
	messages: [],
	isStreaming: false,
	isProcessRunning: false,
};

function reducer( state: State, action: Action ): State {
	switch ( action.type ) {
		case 'PROCESS_STARTED':
			return { ...state, isProcessRunning: true };

		case 'PROCESS_STOPPED':
			return { ...state, isProcessRunning: false, isStreaming: false };

		case 'ADD_USER_MESSAGE':
			return {
				...state,
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
			return {
				...state,
				isStreaming: true,
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
			const lastAssistant = getLastAssistantMessage( state.messages );
			if ( ! lastAssistant ) {
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

		case 'TEXT_COMPLETE':
			return state;

		case 'TOOL_USE_START': {
			const lastAssistant = getLastAssistantMessage( state.messages );
			if ( ! lastAssistant ) {
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
			const lastAssistant = getLastAssistantMessage( state.messages );
			if ( ! lastAssistant ) {
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
				turnCost: action.cost,
			};

		case 'PERMISSION_REQUEST':
			return { ...state, pendingPermission: action.request };

		case 'PERMISSION_RESOLVED':
			return { ...state, pendingPermission: undefined };

		case 'ERROR': {
			// Add error as an assistant message
			return {
				...state,
				isStreaming: false,
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
		}

		case 'CLEAR':
			return { ...initialState, isProcessRunning: state.isProcessRunning };

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
	const wrapperRef = useRef< HTMLDivElement >( null );

	// Start the CLI process on mount
	useEffect( () => {
		const startProcess = async () => {
			try {
				const siteUrl = 'url' in selectedSite ? selectedSite.url : '';
				await getIpcApi().studioCodeStart(
					selectedSite.id,
					selectedSite.path,
					selectedSite.name,
					siteUrl
				);
				dispatch( { type: 'PROCESS_STARTED' } );
			} catch {
				dispatch( { type: 'ERROR', message: __( 'Failed to start Studio Code process.' ) } );
			}
		};
		void startProcess();

		return () => {
			getIpcApi().studioCodeStop( selectedSite.id );
		};
		// Only depend on individual properties, not the full object reference
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ selectedSite.id, selectedSite.path, selectedSite.name ] );

	// Listen for IPC events
	const handleEvent = useCallback(
		( _event: unknown, data: { siteId: string; event: StudioCodeEvent } ) => {
			if ( data.siteId !== selectedSite.id ) {
				return;
			}
			const evt = data.event;

			switch ( evt.type ) {
				case 'ready':
					// Process is ready
					break;

				case 'text_delta':
					dispatch( { type: 'APPEND_TEXT', text: evt.text } );
					break;

				case 'text_complete':
					dispatch( { type: 'TEXT_COMPLETE' } );
					break;

				case 'tool_use_start':
					dispatch( {
						type: 'TOOL_USE_START',
						id: evt.id,
						name: evt.name,
						input: evt.input,
					} );
					break;

				case 'tool_result':
					dispatch( {
						type: 'TOOL_RESULT',
						id: evt.id,
						output: evt.output,
						isError: evt.isError,
					} );
					break;

				case 'turn_complete':
					dispatch( {
						type: 'TURN_COMPLETE',
						sessionId: evt.sessionId,
						cost: evt.cost,
					} );
					break;

				case 'permission_request':
					dispatch( {
						type: 'PERMISSION_REQUEST',
						request: {
							id: evt.id,
							toolName: evt.toolName,
							input: evt.input,
							description: evt.description,
						},
					} );
					break;

				case 'error':
					dispatch( { type: 'ERROR', message: evt.message } );
					break;
			}
		},
		[ selectedSite.id ]
	);

	useIpcListener( 'studio-code-event', handleEvent );

	// Auto-scroll on new messages
	useEffect( () => {
		messagesEndRef.current?.scrollIntoView( { behavior: 'smooth' } );
	}, [ state.messages, state.isStreaming ] );

	// Callbacks for AIInput
	const handleSend = useCallback( () => {
		const text = inputValue.trim();
		if ( ! text || state.isStreaming ) {
			return;
		}

		dispatch( { type: 'ADD_USER_MESSAGE', text } );
		dispatch( { type: 'START_ASSISTANT_MESSAGE' } );
		setInputValue( '' );

		void getIpcApi().studioCodeSend( selectedSite.id, { type: 'message', text } );
	}, [ inputValue, state.isStreaming, selectedSite.id ] );

	const handleKeyDown = useCallback( () => {
		// Key handling is done by AIInput internally
	}, [] );

	const clearConversation = useCallback( () => {
		dispatch( { type: 'CLEAR' } );
	}, [] );

	const handlePermissionRespond = useCallback(
		( id: string, allowed: boolean ) => {
			dispatch( { type: 'PERMISSION_RESOLVED' } );
			void getIpcApi().studioCodeSend( selectedSite.id, {
				type: 'permission_response',
				id,
				allowed,
			} );
		},
		[ selectedSite.id ]
	);

	return (
		<div className="flex flex-col h-full">
			<div ref={ wrapperRef } className="flex-1 overflow-y-auto px-4 pb-4">
				{ state.messages.map( ( message ) => (
					<StudioCodeMessage key={ message.id } message={ message } siteId={ selectedSite.id } />
				) ) }
				{ state.isStreaming && state.messages[ state.messages.length - 1 ]?.content === '' && (
					<div className="flex justify-start ltr:md:mr-24 rtl:md:ml-24 mt-4">
						<div className="inline-block p-3 rounded border border-frame-border bg-frame/45">
							<MessageThinking />
						</div>
					</div>
				) }
				{ state.pendingPermission && (
					<StudioCodePermission
						permission={ state.pendingPermission }
						onRespond={ handlePermissionRespond }
					/>
				) }
				{ state.turnCost !== undefined && state.turnCost > 0 && ! state.isStreaming && (
					<div className="text-center text-xs text-frame-text-secondary py-1">
						{ `${ __( 'Turn cost:' ) } $${ state.turnCost.toFixed( 4 ) }` }
					</div>
				) }
				<div ref={ messagesEndRef } />
			</div>
			<div className="px-4 pb-4">
				<AIInput
					disabled={ ! state.isProcessRunning }
					input={ inputValue }
					setInput={ setInputValue }
					handleSend={ handleSend }
					handleKeyDown={ handleKeyDown }
					clearConversation={ clearConversation }
					isAssistantThinking={ state.isStreaming }
				/>
			</div>
		</div>
	);
}
