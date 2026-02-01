/**
 * ACP IPC Handlers
 *
 * IPC handlers for ACP operations in the main process.
 */

import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { SiteServer } from 'src/site-server';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import { DEFAULT_AGENT_ID } from '../config/agents';
import { createFullAccessCallbacksHandler } from './acp-callbacks';
import { getAcpProcessManager } from './acp-process-manager';
import { detectInstalledAgents, detectAgentById } from './agent-detection';
import type { AgentConfig, AcpSession } from '../types';
import type { SessionNotification } from '@agentclientprotocol/sdk';

/**
 * Store for session-specific event handlers so they can be cleaned up.
 */
interface SessionHandlers {
	updateHandler: ( sessionId: string, notification: SessionNotification ) => void;
	errorHandler: ( sessionId: string, error: Error ) => void;
	closedHandler: ( sessionId: string, code: number | null, signal: string | null ) => void;
}
const sessionHandlers = new Map< string, SessionHandlers >();

/**
 * Transform SDK SessionNotification to our expected format for the renderer.
 *
 * SDK uses flat structures:
 * - agent_message_chunk: { content: ContentBlock, sessionUpdate: "agent_message_chunk" }
 * - agent_thought_chunk: { content: ContentBlock, sessionUpdate: "agent_thought_chunk" }
 * - tool_call: { toolCallId, title, rawInput, ..., sessionUpdate: "tool_call" }
 * - tool_call_update: { toolCallId, rawOutput, content, status, ..., sessionUpdate: "tool_call_update" }
 */
function transformSessionUpdate(
	sessionId: string,
	notification: SessionNotification
): {
	sessionId: string;
	type: string;
	text?: string;
	tool_use?: { id: string; name: string; input: Record< string, unknown > };
	tool_result?: { tool_use_id: string; output?: string; error?: string };
	thinking?: string;
	done?: boolean;
} | null {
	const update = notification.update;

	// Handle different update types from the SDK
	switch ( update.sessionUpdate ) {
		case 'agent_message_chunk': {
			// Text content from agent - SDK has { content: ContentBlock }
			const content = update.content;
			if ( content?.type === 'text' ) {
				const textContent = content as { type: 'text'; text: string };
				return {
					sessionId,
					type: 'text',
					text: textContent.text,
				};
			}
			return null;
		}

		case 'agent_thought_chunk': {
			// Thinking/reasoning content - same structure as agent_message_chunk
			const content = update.content;
			if ( content?.type === 'text' ) {
				const textContent = content as { type: 'text'; text: string };
				return {
					sessionId,
					type: 'thinking',
					thinking: textContent.text,
				};
			}
			return null;
		}

		case 'tool_call': {
			// Tool call from agent - SDK has flat structure
			// update IS the ToolCall (with toolCallId, title, rawInput, etc.)
			return {
				sessionId,
				type: 'tool_use',
				tool_use: {
					id: update.toolCallId,
					name: update.title,
					input: ( update.rawInput ?? {} ) as Record< string, unknown >,
				},
			};
		}

		case 'tool_call_update': {
			// Tool result - SDK has flat structure
			// update IS the ToolCallUpdate (with toolCallId, rawOutput, content, status, etc.)
			// Extract text output from rawOutput or content
			let output = '';

			if ( update.rawOutput !== undefined ) {
				output =
					typeof update.rawOutput === 'string'
						? update.rawOutput
						: JSON.stringify( update.rawOutput );
			} else if ( Array.isArray( update.content ) ) {
				// Extract text from content array
				output = update.content
					.map( ( c ) => {
						if ( c.type === 'content' && c.content ) {
							const contentBlocks = Array.isArray( c.content ) ? c.content : [ c.content ];
							return contentBlocks
								.filter(
									( block ): block is { type: 'text'; text: string } =>
										typeof block === 'object' &&
										block !== null &&
										'type' in block &&
										block.type === 'text'
								)
								.map( ( block ) => block.text )
								.join( '\n' );
						}
						return '';
					} )
					.filter( Boolean )
					.join( '\n' );
			}

			// Only emit tool_result if we have content or a completed/failed status
			if ( output || update.status === 'completed' || update.status === 'failed' ) {
				return {
					sessionId,
					type: 'tool_result',
					tool_result: {
						tool_use_id: update.toolCallId,
						output: output || '(completed)',
						error: update.status === 'failed' ? output : undefined,
					},
				};
			}
			return null;
		}

		case 'plan':
		case 'available_commands_update':
		case 'current_mode_update':
		case 'config_option_update':
		case 'session_info_update':
			// These don't need to be forwarded to the UI for now
			return null;

		default:
			console.log(
				`ACP: Unhandled session update type: ${
					( update as { sessionUpdate: string } ).sessionUpdate
				}`
			);
			return null;
	}
}

/**
 * Get the list of available agents (built-in + detected ACP agents).
 */
export async function getAvailableAgents( _event: IpcMainInvokeEvent ): Promise< AgentConfig[] > {
	return detectInstalledAgents();
}

/**
 * Detect installed agents and return the list.
 */
export async function detectAgents( _event: IpcMainInvokeEvent ): Promise< AgentConfig[] > {
	return detectInstalledAgents();
}

/**
 * Get the currently selected agent ID.
 */
export async function getSelectedAgentId( _event: IpcMainInvokeEvent ): Promise< string > {
	const userData = await loadUserData();
	return userData.selectedAgentId ?? DEFAULT_AGENT_ID;
}

/**
 * Set the selected agent ID.
 */
export async function setSelectedAgentId(
	_event: IpcMainInvokeEvent,
	agentId: string
): Promise< void > {
	// Verify the agent exists
	const agent = await detectAgentById( agentId );
	if ( ! agent ) {
		throw new Error( `Unknown agent: ${ agentId }` );
	}

	await updateAppdata( { selectedAgentId: agentId } );
}

/**
 * Clean up event handlers for a session.
 */
function cleanupSessionHandlers( sessionId: string ): void {
	const handlers = sessionHandlers.get( sessionId );
	if ( handlers ) {
		const processManager = getAcpProcessManager();
		processManager.off( 'session_update', handlers.updateHandler );
		processManager.off( 'session_error', handlers.errorHandler );
		processManager.off( 'session_closed', handlers.closedHandler );
		sessionHandlers.delete( sessionId );
	}
}

/**
 * Create a new ACP session for a site.
 */
export async function createAcpSession(
	event: IpcMainInvokeEvent,
	agentId: string,
	siteId: string
): Promise< AcpSession > {
	// Get the site's working directory
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( `Site not found: ${ siteId }` );
	}

	const workingDirectory = site.details.path;
	console.log(
		`ACP: Creating session for site ${ siteId } with working directory: ${ workingDirectory }`
	);
	console.log( `ACP: Site details:`, {
		id: site.details.id,
		name: site.details.name,
		path: site.details.path,
	} );
	const processManager = getAcpProcessManager();

	// Create callback handler for this site
	const fileCallbacks = createFullAccessCallbacksHandler( workingDirectory );

	// Set up event forwarding to renderer
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const callbackHandler = {
		...fileCallbacks,
		requestPermission: async (
			toolCall: unknown,
			options: Array< { optionId: string; name: string; kind: string } >
		): Promise< { outcome: 'selected' | 'cancelled'; optionId?: string } > => {
			if ( ! parentWindow ) {
				return { outcome: 'cancelled' };
			}

			if ( options.length === 0 ) {
				return { outcome: 'cancelled' };
			}

			const optionButtons = options.map( ( option ) => option.name );
			const defaultId = Math.max(
				0,
				options.findIndex(
					( option ) => option.kind === 'allow_once' || option.kind === 'allow_always'
				)
			);
			const cancelId = Math.max(
				0,
				options.findIndex( ( option ) => option.kind === 'deny' || option.kind === 'cancel' )
			);

			const toolCallSummary = ( () => {
				if ( ! toolCall ) {
					return 'Unknown tool request.';
				}
				try {
					const summary = JSON.stringify( toolCall, null, 2 );
					return summary.length > 800 ? summary.slice( 0, 800 ) + '\n…' : summary;
				} catch {
					return String( toolCall );
				}
			} )();

			const { response } = await dialog.showMessageBox( parentWindow, {
				type: 'question',
				buttons: optionButtons,
				defaultId,
				cancelId,
				title: 'Agent Permission Request',
				message: 'An agent is requesting permission to perform an action.',
				detail: toolCallSummary,
				noLink: true,
			} );

			const selectedOption = options[ response ];
			if ( ! selectedOption ) {
				return { outcome: 'cancelled' };
			}

			return { outcome: 'selected', optionId: selectedOption.optionId };
		},
	};

	// Create the session first to get the session ID
	const session = await processManager.createSession(
		agentId,
		siteId,
		workingDirectory,
		callbackHandler
	);

	const createdSessionId = session.id;

	// Create session-specific handlers that only process events for this session
	const sessionUpdateHandler = ( eventSessionId: string, notification: SessionNotification ) => {
		// Only handle events for this specific session
		if ( eventSessionId !== createdSessionId ) {
			return;
		}
		const transformed = transformSessionUpdate( eventSessionId, notification );
		if ( transformed ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'acp-session-update', transformed );
		}
	};

	const sessionErrorHandler = ( eventSessionId: string, error: Error ) => {
		// Only handle events for this specific session
		if ( eventSessionId !== createdSessionId ) {
			return;
		}
		sendIpcEventToRendererWithWindow( parentWindow, 'acp-session-error', {
			sessionId: eventSessionId,
			error: error.message,
		} );
	};

	const sessionClosedHandler = (
		eventSessionId: string,
		code: number | null,
		signal: string | null
	) => {
		// Only handle events for this specific session
		if ( eventSessionId !== createdSessionId ) {
			return;
		}
		sendIpcEventToRendererWithWindow( parentWindow, 'acp-session-closed', {
			sessionId: eventSessionId,
			code,
			signal,
		} );
		// Clean up handlers when session closes
		cleanupSessionHandlers( createdSessionId );
	};

	// Store handlers for cleanup
	sessionHandlers.set( createdSessionId, {
		updateHandler: sessionUpdateHandler,
		errorHandler: sessionErrorHandler,
		closedHandler: sessionClosedHandler,
	} );

	// Add event listeners
	processManager.on( 'session_update', sessionUpdateHandler );
	processManager.on( 'session_error', sessionErrorHandler );
	processManager.on( 'session_closed', sessionClosedHandler );

	return session;
}

/**
 * Send a prompt to an ACP session.
 */
export async function sendAcpPrompt(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	prompt: string
): Promise< { stopReason: string } > {
	const processManager = getAcpProcessManager();

	const result = await processManager.sendPrompt( sessionId, prompt );

	return { stopReason: result.stopReason };
}

/**
 * Send an approval response to an ACP session.
 * Note: With the official SDK, approvals are handled via the Client.requestPermission callback.
 * This handler is kept for API compatibility but may not be needed.
 */
export async function sendAcpApproval(
	_event: IpcMainInvokeEvent,
	_sessionId: string,
	_approvalId: string,
	_approved: boolean,
	_selectedOption?: string
): Promise< void > {
	// Approvals are now handled through the SDK's requestPermission callback
	// in the Client interface, not as a separate IPC call.
	console.warn( 'sendAcpApproval called but approvals are handled via SDK callbacks' );
}

/**
 * Close an ACP session.
 */
export async function closeAcpSession(
	_event: IpcMainInvokeEvent,
	sessionId: string
): Promise< void > {
	const processManager = getAcpProcessManager();

	// Clean up event handlers first
	cleanupSessionHandlers( sessionId );

	await processManager.closeSession( sessionId );
}

/**
 * Get an ACP session by ID.
 */
export async function getAcpSession(
	_event: IpcMainInvokeEvent,
	sessionId: string
): Promise< AcpSession | null > {
	const processManager = getAcpProcessManager();

	return processManager.getSession( sessionId ) ?? null;
}

/**
 * Get all active ACP sessions for a site.
 */
export async function getAcpSessionsForSite(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< AcpSession[] > {
	const processManager = getAcpProcessManager();

	return processManager.getSessionsForSite( siteId );
}

/**
 * Close all ACP sessions.
 */
export async function closeAllAcpSessions( _event: IpcMainInvokeEvent ): Promise< void > {
	const processManager = getAcpProcessManager();

	// Clean up all event handlers
	for ( const sessionId of sessionHandlers.keys() ) {
		cleanupSessionHandlers( sessionId );
	}

	await processManager.closeAllSessions();
}

/**
 * Get available models for an ACP session.
 * Returns null if the agent doesn't support model selection.
 */
export async function getAcpSessionModels(
	_event: IpcMainInvokeEvent,
	sessionId: string
): Promise< {
	availableModels: Array< { modelId: string; name: string; description?: string } >;
	currentModelId: string;
} | null > {
	const processManager = getAcpProcessManager();

	return processManager.getSessionModels( sessionId );
}

/**
 * Set the model for an ACP session.
 */
export async function setAcpSessionModel(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	modelId: string
): Promise< void > {
	const processManager = getAcpProcessManager();

	await processManager.setModel( sessionId, modelId );
}
