import { v4 as uuidv4 } from 'uuid';
import { startAiAgent, type AiAgentConfig, type AskUserQuestion } from 'cli/ai/agent';
import type { Message } from '@a2a-js/sdk';
import type {
	AgentExecutor,
	ExecutionEventBus,
	RequestContext,
} from '@a2a-js/sdk/server';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentMessage( text: string ): Message {
	return {
		kind: 'message',
		messageId: uuidv4(),
		role: 'agent',
		parts: [ { kind: 'text', text } ],
	};
}

function extractPrompt( ctx: RequestContext ): string {
	const parts = ctx.userMessage.parts ?? [];
	return (
		parts
			.filter( ( p ): p is { kind: 'text'; text: string } => p.kind === 'text' )
			.map( ( p ) => p.text )
			.join( '\n' ) || 'Hello'
	);
}

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

// ---------------------------------------------------------------------------
// Agent session — keeps a running agent alive across A2A execute() calls
// ---------------------------------------------------------------------------

type SessionEvent =
	| { kind: 'text'; text: string }
	| { kind: 'tool-use'; name: string }
	| {
			kind: 'question';
			questions: AskUserQuestion[];
			resolve: ( answers: Record< string, string > ) => void;
	  }
	| { kind: 'result'; success: boolean; text: string }
	| { kind: 'error'; message: string }
	| { kind: 'done' };

/**
 * Wraps a running Studio Code agent and exposes its output as an async event
 * queue. The agent runs in the background; events are drained by the executor
 * on each A2A execute() call.
 *
 * When the agent asks a question (via onAskUser), the session stores the
 * pending resolve function. The executor publishes `input-required` to A2A
 * and returns. When the client sends a continuation, the executor resolves
 * the pending question and resumes draining.
 */
class AgentSession {
	private events: SessionEvent[] = [];
	private waitResolve: ( () => void ) | null = null;
	private _finished = false;
	private queryHandle: ReturnType< typeof startAiAgent > | null = null;

	/** Pending question waiting for the client's answer. */
	pendingQuestion: {
		questions: AskUserQuestion[];
		resolve: ( answers: Record< string, string > ) => void;
	} | null = null;

	aborted = false;

	start( prompt: string ) {
		const config: AiAgentConfig = {
			prompt,
			maxTurns: 50,
			onAskUser: async ( questions ) => {
				return new Promise< Record< string, string > >( ( resolve ) => {
					this.push( { kind: 'question', questions, resolve } );
				} );
			},
		};

		this.queryHandle = startAiAgent( config );

		// Run the agent in the background, pushing events to the queue
		( async () => {
			try {
				for await ( const message of this.queryHandle! ) {
					if ( this.aborted ) {
						break;
					}

					const text = extractAssistantText( message );
					if ( text ) {
						this.push( { kind: 'text', text } );
					}

					const toolUse = extractToolUse( message );
					if ( toolUse ) {
						this.push( { kind: 'tool-use', name: toolUse.name } );
					}

					if ( message.type === 'result' ) {
						const resultText =
							message.subtype === 'success'
								? message.result
								: `Agent error: ${ message.subtype }`;
						this.push( {
							kind: 'result',
							success: message.subtype === 'success',
							text: resultText,
						} );
					}
				}
			} catch ( error ) {
				const errorMessage = error instanceof Error ? error.message : String( error );
				this.push( { kind: 'error', message: errorMessage } );
			} finally {
				this._finished = true;
				this.push( { kind: 'done' } );
			}
		} )();
	}

	interrupt() {
		this.aborted = true;
		this.queryHandle?.interrupt();
	}

	get finished() {
		return this._finished;
	}

	/** Wait for and return the next event, or null if done. */
	async nextEvent(): Promise< SessionEvent | null > {
		if ( this.events.length > 0 ) {
			return this.events.shift()!;
		}
		if ( this._finished ) {
			return null;
		}
		await new Promise< void >( ( resolve ) => {
			this.waitResolve = resolve;
		} );
		return this.events.shift() ?? null;
	}

	private push( event: SessionEvent ) {
		this.events.push( event );
		if ( this.waitResolve ) {
			const resolve = this.waitResolve;
			this.waitResolve = null;
			resolve();
		}
	}
}

// ---------------------------------------------------------------------------
// A2A Executor
// ---------------------------------------------------------------------------

/**
 * A2A AgentExecutor that wraps the Studio Code AI agent.
 *
 * Each A2A context spawns a full Studio Code agent session. The session persists
 * across execute() calls so that the agent can ask questions back to the calling
 * agent (via A2A's input-required state) and resume when answers arrive.
 */
export class StudioCodeExecutor implements AgentExecutor {
	private sessions = new Map< string, AgentSession >();

	async execute( ctx: RequestContext, bus: ExecutionEventBus ): Promise< void > {
		const { taskId, contextId, userMessage } = ctx;
		const userText = extractPrompt( ctx );

		let session = this.sessions.get( contextId );

		if ( session?.pendingQuestion ) {
			// Continuation — the client is answering a pending question.
			// Resolve the promise so the agent can continue.
			const { questions, resolve } = session.pendingQuestion;
			session.pendingQuestion = null;

			const answers: Record< string, string > = {};
			for ( const q of questions ) {
				answers[ q.question ] = userText;
			}
			resolve( answers );

			// Report that we're working again
			bus.publish( {
				kind: 'status-update',
				taskId,
				contextId,
				final: false,
				status: {
					state: 'working',
					timestamp: new Date().toISOString(),
					message: agentMessage( 'Resuming...' ),
				},
			} );
		} else if ( ! session ) {
			// New task — create session and start the agent
			session = new AgentSession();
			this.sessions.set( contextId, session );

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

			session.start( userText );
		}

		// Drain events until the agent finishes or asks a question
		await this.drainEvents( session, taskId, contextId, bus );
	}

	private async drainEvents(
		session: AgentSession,
		taskId: string,
		contextId: string,
		bus: ExecutionEventBus
	): Promise< void > {
		while ( true ) {
			const event = await session.nextEvent();
			if ( ! event ) {
				bus.publish( {
					kind: 'status-update',
					taskId,
					contextId,
					final: true,
					status: {
						state: session.aborted ? 'canceled' : 'completed',
						timestamp: new Date().toISOString(),
					},
				} );
				this.sessions.delete( contextId );
				bus.finished();
				return;
			}

			switch ( event.kind ) {
				case 'text':
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: false,
						status: {
							state: 'working',
							timestamp: new Date().toISOString(),
							message: agentMessage( event.text ),
						},
					} );
					break;

				case 'tool-use':
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: false,
						status: {
							state: 'working',
							timestamp: new Date().toISOString(),
							message: agentMessage( `Using tool: ${ event.name }` ),
						},
					} );
					break;

				case 'question': {
					// Format questions for the calling agent
					const questionText = event.questions
						.map( ( q ) => {
							const opts = q.options.map( ( o ) => o.label ).join( ', ' );
							return opts ? `${ q.question }\nOptions: ${ opts }` : q.question;
						} )
						.join( '\n\n' );

					// Store the resolver so the next execute() call can feed the answer
					session.pendingQuestion = {
						questions: event.questions,
						resolve: event.resolve,
					};

					// Tell the client we need input, then return.
					// The next execute() call will resolve the question and resume.
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
					bus.finished();
					return;
				}

				case 'result':
					bus.publish( {
						kind: 'artifact-update',
						taskId,
						contextId,
						artifact: {
							artifactId: uuidv4(),
							name: 'Agent Response',
							parts: [ { kind: 'text', text: event.text } ],
						},
					} );
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: true,
						status: {
							state: event.success ? 'completed' : 'failed',
							timestamp: new Date().toISOString(),
						},
					} );
					this.sessions.delete( contextId );
					bus.finished();
					return;

				case 'error':
					bus.publish( {
						kind: 'status-update',
						taskId,
						contextId,
						final: true,
						status: {
							state: 'failed',
							timestamp: new Date().toISOString(),
							message: agentMessage( `Agent failed: ${ event.message }` ),
						},
					} );
					this.sessions.delete( contextId );
					bus.finished();
					return;

				case 'done':
					this.sessions.delete( contextId );
					bus.finished();
					return;
			}
		}
	}

	async cancelTask( taskId: string ): Promise< void > {
		for ( const session of this.sessions.values() ) {
			session.interrupt();
		}
	}
}
