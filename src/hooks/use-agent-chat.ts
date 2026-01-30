import { useCallback, useEffect, useRef } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { agentChatActions, agentChatSelectors, AgentMessage } from 'src/stores/agent-chat-slice';

// Stable handler refs to avoid StrictMode double-subscription issues
interface AcpSessionUpdateData {
	sessionId: string;
	type: string;
	text?: string;
	tool_use?: { id: string; name: string; input: Record< string, unknown > };
	tool_result?: { tool_use_id: string; output?: string; error?: string };
	thinking?: string;
	progress?: { message: string; percentage?: number };
	approval_request?: { id: string; message: string; options: string[] };
	error?: { code: string; message: string };
}

interface ServerEvent {
	type: string;
	data: unknown;
}

interface UseAgentChatOptions {
	siteId: string;
}

interface UseAgentChatResult {
	messages: readonly AgentMessage[];
	isLoading: boolean;
	isStreaming: boolean;
	sendMessage: ( message: string ) => Promise< void >;
	clearConversation: () => void;
	instanceId: string;
}

/**
 * Hook for managing agent chat interactions.
 *
 * Supports two modes:
 * - Built-in Anthropic agent: Uses HTTP/SSE streaming
 * - ACP agents: Uses IPC with ACP process manager
 *
 * Handles:
 * - Sending messages to the appropriate backend
 * - Parsing responses and dispatching Redux actions
 * - Error handling
 */
export function useAgentChat( { siteId }: UseAgentChatOptions ): UseAgentChatResult {
	const dispatch = useAppDispatch();
	const instanceId = `agent_${ siteId }`;

	// Track ACP session ID for this chat
	const acpSessionIdRef = useRef< string | null >( null );

	const messages = useRootSelector( ( state ) =>
		agentChatSelectors.selectMessages( state, instanceId )
	) as AgentMessage[];

	const isLoading = useRootSelector( ( state ) =>
		agentChatSelectors.selectIsLoading( state, instanceId )
	);

	const isStreaming = useRootSelector( ( state ) =>
		agentChatSelectors.selectIsStreaming( state, instanceId )
	);

	const serverPort = useRootSelector( agentChatSelectors.selectAgentServerPort );

	// Get the selected agent to determine which backend to use
	const selectedAgent = useRootSelector( agentChatSelectors.selectSelectedAgent );

	const handleServerEvent = useCallback(
		( event: ServerEvent ) => {
			switch ( event.type ) {
				case 'content_block_start': {
					const data = event.data as {
						index: number;
						blockType: 'text' | 'tool_use';
						id?: string;
						name?: string;
					};
					dispatch(
						agentChatActions.startContentBlock( {
							instanceId,
							index: data.index,
							blockType: data.blockType,
							id: data.id,
							name: data.name,
						} )
					);
					break;
				}
				case 'content_delta': {
					const data = event.data as { index: number; text: string };
					dispatch(
						agentChatActions.appendToAssistantMessage( {
							instanceId,
							text: data.text,
							index: data.index,
						} )
					);
					break;
				}
				case 'content_block_stop': {
					const data = event.data as {
						index: number;
						blockType: 'text' | 'tool_use';
						id?: string;
						name?: string;
						input?: Record< string, unknown >;
					};
					dispatch(
						agentChatActions.finishContentBlock( {
							instanceId,
							index: data.index,
							blockType: data.blockType,
							id: data.id,
							name: data.name,
							input: data.input,
						} )
					);
					break;
				}
				case 'tool_use_start': {
					// Legacy event - kept for backwards compatibility
					const data = event.data as {
						id: string;
						name: string;
						input: Record< string, unknown >;
					};
					dispatch(
						agentChatActions.addToolCall( {
							instanceId,
							toolCall: data,
						} )
					);
					break;
				}
				case 'tool_result': {
					const data = event.data as {
						toolCallId: string;
						result: { success: boolean; output?: string; error?: string };
					};
					dispatch(
						agentChatActions.addToolResult( {
							instanceId,
							toolCallId: data.toolCallId,
							result: data.result,
						} )
					);
					break;
				}
				case 'message_done': {
					dispatch( agentChatActions.finishAssistantMessage( { instanceId } ) );
					break;
				}
				case 'error': {
					const data = event.data as { message: string };
					dispatch(
						agentChatActions.setMessageError( {
							instanceId,
							error: data.message,
						} )
					);
					break;
				}
			}
		},
		[ dispatch, instanceId ]
	);

	/**
	 * Handle ACP session update events from the main process.
	 * This function is stored in a ref to avoid useEffect re-running on changes.
	 */
	const handleAcpSessionUpdate = useCallback(
		( data: AcpSessionUpdateData ) => {
			// Only handle events for our session
			if ( data.sessionId !== acpSessionIdRef.current ) {
				return;
			}

			switch ( data.type ) {
				case 'text':
					if ( data.text ) {
						dispatch(
							agentChatActions.appendToAssistantMessage( {
								instanceId,
								text: data.text,
							} )
						);
					}
					break;

				case 'tool_use':
					if ( data.tool_use ) {
						dispatch(
							agentChatActions.addToolCall( {
								instanceId,
								toolCall: {
									id: data.tool_use.id,
									name: data.tool_use.name,
									input: data.tool_use.input,
								},
							} )
						);
					}
					break;

				case 'tool_result':
					if ( data.tool_result ) {
						const hasError = !! data.tool_result.error;
						dispatch(
							agentChatActions.addToolResult( {
								instanceId,
								toolCallId: data.tool_result.tool_use_id,
								result: {
									success: ! hasError,
									output: data.tool_result.output,
									error: data.tool_result.error,
								},
							} )
						);
					}
					break;

				case 'end':
					dispatch( agentChatActions.finishAssistantMessage( { instanceId } ) );
					break;

				case 'error':
					if ( data.error ) {
						dispatch(
							agentChatActions.setMessageError( {
								instanceId,
								error: data.error.message,
							} )
						);
					}
					break;
			}
		},
		[ dispatch, instanceId ]
	);

	// Store the handler in a ref to avoid re-subscribing on every render
	const handleAcpSessionUpdateRef = useRef( handleAcpSessionUpdate );
	handleAcpSessionUpdateRef.current = handleAcpSessionUpdate;

	// Set up ACP event listeners
	// Use refs for handlers to avoid StrictMode double-subscription issues
	useEffect( () => {
		const unsubscribeUpdate = window.ipcListener.subscribe(
			'acp-session-update',
			( _event, data ) => {
				// Call through ref to always get the latest handler
				handleAcpSessionUpdateRef.current( data );
			}
		);

		const unsubscribeError = window.ipcListener.subscribe(
			'acp-session-error',
			( _event, data ) => {
				if ( data.sessionId === acpSessionIdRef.current ) {
					dispatch(
						agentChatActions.setMessageError( {
							instanceId,
							error: data.error,
						} )
					);
				}
			}
		);

		const unsubscribeClosed = window.ipcListener.subscribe(
			'acp-session-closed',
			( _event, data ) => {
				if ( data.sessionId === acpSessionIdRef.current ) {
					acpSessionIdRef.current = null;
					// Finish any pending message
					dispatch( agentChatActions.finishAssistantMessage( { instanceId } ) );
				}
			}
		);

		return () => {
			unsubscribeUpdate();
			unsubscribeError();
			unsubscribeClosed();
		};
	// Note: handleAcpSessionUpdate is accessed via ref, so it's not needed in deps
	}, [ dispatch, instanceId ] );

	/**
	 * Send message via built-in Anthropic HTTP server.
	 */
	const sendMessageViaHttp = useCallback(
		async ( message: string ) => {
			if ( ! serverPort ) {
				dispatch(
					agentChatActions.setMessageError( {
						instanceId,
						error: 'Agent server not running',
					} )
				);
				return;
			}

			try {
				const response = await fetch( `http://127.0.0.1:${ serverPort }/chat`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( {
						message,
						siteId,
						instanceId,
						history: messages.map( ( m ) => ( {
							role: m.role,
							content: m.content,
						} ) ),
					} ),
				} );

				if ( ! response.ok ) {
					const error = await response.json();
					throw new Error( error.error || 'Failed to send message' );
				}

				// Process SSE stream
				const reader = response.body?.getReader();
				if ( ! reader ) {
					throw new Error( 'No response body' );
				}

				const decoder = new TextDecoder();
				let buffer = '';

				while ( true ) {
					const { done, value } = await reader.read();
					if ( done ) {
						break;
					}

					buffer += decoder.decode( value, { stream: true } );
					const lines = buffer.split( '\n' );
					buffer = lines.pop() || '';

					for ( const line of lines ) {
						if ( line.startsWith( 'data: ' ) ) {
							try {
								const event = JSON.parse( line.slice( 6 ) ) as ServerEvent;
								handleServerEvent( event );
							} catch ( e ) {
								console.error( 'Failed to parse SSE event:', e );
							}
						}
					}
				}
			} catch ( error ) {
				const errorMessage = error instanceof Error ? error.message : String( error );
				dispatch(
					agentChatActions.setMessageError( {
						instanceId,
						error: errorMessage,
					} )
				);
			}
		},
		[ dispatch, handleServerEvent, instanceId, messages, serverPort, siteId ]
	);

	/**
	 * Send message via ACP process manager.
	 */
	const sendMessageViaAcp = useCallback(
		async ( message: string, agentId: string ) => {
			try {
				// Create ACP session if we don't have one
				if ( ! acpSessionIdRef.current ) {
					const session = await getIpcApi().createAcpSession( agentId, siteId );
					acpSessionIdRef.current = session.id;

					// Store session in Redux
					dispatch( agentChatActions.setAcpSession( session ) );
				}

				// Send prompt to ACP agent
				const result = await getIpcApi().sendAcpPrompt( acpSessionIdRef.current, message );

				// Finish the message when prompt completes
				if ( result.stopReason ) {
					dispatch( agentChatActions.finishAssistantMessage( { instanceId } ) );
				}
			} catch ( error ) {
				const errorMessage = error instanceof Error ? error.message : String( error );
				dispatch(
					agentChatActions.setMessageError( {
						instanceId,
						error: errorMessage,
					} )
				);
			}
		},
		[ dispatch, instanceId, siteId ]
	);

	const sendMessage = useCallback(
		async ( message: string ) => {
			if ( ! message.trim() || isLoading || isStreaming ) {
				return;
			}

			// Add user message
			dispatch( agentChatActions.addUserMessage( { instanceId, message } ) );

			// Start assistant message placeholder
			dispatch( agentChatActions.startAssistantMessage( { instanceId } ) );

			// Route to appropriate backend based on agent provider
			if ( selectedAgent?.provider === 'acp' ) {
				await sendMessageViaAcp( message, selectedAgent.id );
			} else {
				// Default to built-in HTTP server (anthropic-builtin)
				await sendMessageViaHttp( message );
			}
		},
		[
			dispatch,
			instanceId,
			isLoading,
			isStreaming,
			selectedAgent,
			sendMessageViaAcp,
			sendMessageViaHttp,
		]
	);

	const clearConversation = useCallback( () => {
		dispatch( agentChatActions.clearMessages( { instanceId } ) );

		// Close ACP session if one exists
		if ( acpSessionIdRef.current ) {
			getIpcApi().closeAcpSession( acpSessionIdRef.current ).catch( console.error );
			acpSessionIdRef.current = null;
		}
	}, [ dispatch, instanceId ] );

	// Clean up ACP session on unmount
	useEffect( () => {
		return () => {
			if ( acpSessionIdRef.current ) {
				getIpcApi().closeAcpSession( acpSessionIdRef.current ).catch( console.error );
			}
		};
	}, [] );

	return {
		messages,
		isLoading,
		isStreaming,
		sendMessage,
		clearConversation,
		instanceId,
	};
}
