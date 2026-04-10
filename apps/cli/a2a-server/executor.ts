import { v4 as uuidv4 } from 'uuid';
import { startAiAgent, type AiAgentConfig } from 'cli/ai/agent';
import type { Message } from '@a2a-js/sdk';
import type {
	AgentExecutor,
	ExecutionEventBus,
	RequestContext,
} from '@a2a-js/sdk/server';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Helper to create a well-formed A2A Message.
 */
function agentMessage( text: string ): Message {
	return {
		kind: 'message',
		messageId: uuidv4(),
		role: 'agent',
		parts: [ { kind: 'text', text } ],
	};
}

/**
 * Extracts the user's text prompt from an A2A message.
 */
function extractPrompt( ctx: RequestContext ): string {
	const parts = ctx.userMessage.parts ?? [];
	const textParts = parts
		.filter( ( p ): p is { kind: 'text'; text: string } => p.kind === 'text' )
		.map( ( p ) => p.text );
	return textParts.join( '\n' ) || 'Hello';
}

/**
 * Extracts displayable text from an SDK assistant message.
 */
function extractAssistantText( message: SDKMessage ): string | null {
	if ( message.type !== 'assistant' ) {
		return null;
	}
	const texts: string[] = [];
	for ( const block of message.message.content ) {
		if ( block.type === 'text' && block.text ) {
			texts.push( block.text );
		}
	}
	return texts.length > 0 ? texts.join( '\n' ) : null;
}

/**
 * Extracts tool use info from an SDK assistant message for status reporting.
 */
function extractToolUse(
	message: SDKMessage
): { name: string; input?: Record< string, unknown > } | null {
	if ( message.type !== 'assistant' ) {
		return null;
	}
	for ( const block of message.message.content ) {
		if ( block.type === 'tool_use' ) {
			return {
				name: ( block as { name: string } ).name,
				input: ( block as { input?: Record< string, unknown > } ).input,
			};
		}
	}
	return null;
}

/**
 * A2A AgentExecutor that wraps the Studio Code AI agent.
 *
 * Each A2A task spawns a full Studio Code agent session. The agent runs
 * its own loop (Claude SDK → MCP tools → Playwright browser) and streams
 * results back through the A2A event bus.
 */
export class StudioCodeExecutor implements AgentExecutor {
	private activeTasks = new Map< string, { abort: () => void } >();

	async execute( ctx: RequestContext, bus: ExecutionEventBus ): Promise< void > {
		const { taskId, contextId, userMessage, task } = ctx;
		const prompt = extractPrompt( ctx );

		// Create task if new
		if ( ! task ) {
			bus.publish( {
				kind: 'task',
				id: taskId,
				contextId,
				status: {
					state: 'submitted',
					timestamp: new Date().toISOString(),
				},
				history: [ userMessage ],
			} );
		}

		// Report working
		bus.publish( {
			kind: 'status-update',
			taskId,
			contextId,
			final: false,
			status: {
				state: 'working',
				timestamp: new Date().toISOString(),
				message: agentMessage( 'Starting Studio Code agent...' ),
			},
		} );

		let aborted = false;
		const agentConfig: AiAgentConfig = {
			prompt,
			maxTurns: 50,
			// In A2A mode, auto-approve tool calls within trusted roots.
			// The agent's security model still gates filesystem access.
			onAskUser: async ( questions ) => {
				// Report that we need input, with the questions as context
				const questionText = questions
					.map( ( q ) => {
						const opts = q.options.map( ( o ) => o.label ).join( ', ' );
						return `${ q.question } (${ opts })`;
					} )
					.join( '\n' );

				bus.publish( {
					kind: 'status-update',
					taskId,
					contextId,
					final: false,
					status: {
						state: 'input-required',
						timestamp: new Date().toISOString(),
						message: agentMessage( questionText ),
					},
				} );

				// For now, auto-approve with defaults. A full implementation would
				// wait for the A2A client to send a continuation message.
				const answers: Record< string, string > = {};
				for ( const q of questions ) {
					answers[ q.question ] = q.options[ 0 ]?.label ?? 'yes';
				}
				return answers;
			},
		};

		const queryHandle = startAiAgent( agentConfig );

		// Track for cancellation
		this.activeTasks.set( taskId, {
			abort: () => {
				aborted = true;
				queryHandle.interrupt();
			},
		} );

		const collectedText: string[] = [];

		try {
			for await ( const message of queryHandle ) {
				if ( aborted ) {
					break;
				}

				// Extract assistant text for streaming
				const text = extractAssistantText( message );
				if ( text ) {
					collectedText.push( text );
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: false,
						status: {
							state: 'working',
							timestamp: new Date().toISOString(),
							message: agentMessage( text ),
						},
					} );
				}

				// Report tool usage as status updates
				const toolUse = extractToolUse( message );
				if ( toolUse ) {
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: false,
						status: {
							state: 'working',
							timestamp: new Date().toISOString(),
							message: agentMessage( `Using tool: ${ toolUse.name }` ),
						},
					} );
				}

				// Handle result messages
				if ( message.type === 'result' ) {
					const finalText =
						message.subtype === 'success'
							? message.result
							: `Agent error: ${ message.subtype }`;

					bus.publish( {
						kind: 'artifact-update',
						taskId,
						contextId,
						artifact: {
							artifactId: uuidv4(),
							name: 'Agent Response',
							parts: [ { kind: 'text', text: finalText } ],
						},
					} );

					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: true,
						status: {
							state: message.subtype === 'success' ? 'completed' : 'failed',
							timestamp: new Date().toISOString(),
						},
					} );
					bus.finished();
					return;
				}
			}

			// If we reach here without a result message, the agent finished normally
			const finalOutput =
				collectedText.length > 0
					? collectedText.join( '\n\n' )
					: 'Agent completed without output.';

			bus.publish( {
				kind: 'artifact-update',
				taskId,
				contextId,
				artifact: {
					artifactId: uuidv4(),
					name: 'Agent Response',
					parts: [ { kind: 'text', text: finalOutput } ],
				},
			} );

			bus.publish( {
				kind: 'status-update',
				taskId,
				contextId,
				final: true,
				status: {
					state: aborted ? 'canceled' : 'completed',
					timestamp: new Date().toISOString(),
				},
			} );
		} catch ( error ) {
			const errorMessage = error instanceof Error ? error.message : String( error );
			bus.publish( {
				kind: 'status-update',
				taskId,
				contextId,
				final: true,
				status: {
					state: 'failed',
					timestamp: new Date().toISOString(),
					message: agentMessage( `Agent failed: ${ errorMessage }` ),
				},
			} );
		} finally {
			this.activeTasks.delete( taskId );
			bus.finished();
		}
	}

	async cancelTask( taskId: string ): Promise< void > {
		const active = this.activeTasks.get( taskId );
		if ( active ) {
			active.abort();
		}
	}
}
