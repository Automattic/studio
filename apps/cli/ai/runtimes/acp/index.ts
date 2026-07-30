import { spawn, type ChildProcess } from 'child_process';
import { createRequire } from 'node:module';
import path from 'path';
import { Readable, Writable } from 'stream';
import {
	ClientSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type Client,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
	type StopReason as AcpStopReason,
	type ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import { __ } from '@wordpress/i18n';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type {
	AssistantMessage,
	StopReason,
	TextContent,
	ThinkingContent,
	Usage,
	UserMessage,
} from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { StudioAgentTurnConfig, StudioAgentTurnHandle } from 'cli/ai/runtimes/pi';

// The ACP engine runs the official Claude Code harness (via the
// @agentclientprotocol/claude-agent-acp adapter, which wraps
// @anthropic-ai/claude-agent-sdk) so turns bill against the user's Claude
// Pro/Max subscription — the sanctioned path; raw subscription OAuth in a
// third-party harness is rejected server-side by Anthropic.
const ACP_ADAPTER_PACKAGE = '@agentclientprotocol/claude-agent-acp';
const ACP_PROVIDER_NAME = 'claude-code-acp';

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function resolveAdapterEntry(): string {
	const require = createRequire( import.meta.url );
	const packageJsonPath = require.resolve( `${ ACP_ADAPTER_PACKAGE }/package.json` );
	// Path mirrors the package's `bin` entry; the subpath itself isn't exported.

	const binEntry = ( require( packageJsonPath ) as { bin?: Record< string, string > } ).bin?.[
		'claude-agent-acp'
	];
	if ( ! binEntry ) {
		throw new Error( `${ ACP_ADAPTER_PACKAGE } does not expose the claude-agent-acp binary` );
	}
	return path.join( path.dirname( packageJsonPath ), binEntry );
}

function mapAcpStopReason( stopReason: AcpStopReason, interrupted: boolean ): StopReason {
	if ( interrupted || stopReason === 'cancelled' ) {
		return 'aborted';
	}
	if ( stopReason === 'refusal' ) {
		return 'error';
	}
	if ( stopReason === 'max_tokens' ) {
		return 'length';
	}
	return 'stop';
}

interface AcpTurnState {
	interrupted: boolean;
	child?: ChildProcess;
	connection?: ClientSideConnection;
	acpSessionId?: string;
}

export function runAcpAgentTurn( config: StudioAgentTurnConfig ): StudioAgentTurnHandle {
	const state: AcpTurnState = { interrupted: false };

	return {
		result: runTurn( config, state ),
		async interrupt() {
			state.interrupted = true;
			try {
				if ( state.connection && state.acpSessionId ) {
					await state.connection.cancel( { sessionId: state.acpSessionId } );
					return;
				}
			} catch {
				// Fall through to killing the adapter below.
			}
			state.child?.kill( 'SIGTERM' );
		},
	};
}

async function runTurn( config: StudioAgentTurnConfig, state: AcpTurnState ): Promise< void > {
	const { session: sm, onEvent } = config;
	const env = config.env ?? { ...( process.env as Record< string, string > ) };
	const site = config.activeSite;
	const cwd = site && ! site.remote && site.path ? site.path : STUDIO_SITES_ROOT;

	const emit = ( event: AgentSessionEvent ) => onEvent( event );

	const now = () => Date.now();
	const userMessage: UserMessage = {
		role: 'user',
		content: config.prompt,
		timestamp: now(),
	};

	// Streaming accumulation state for the assistant message.
	const content: ( TextContent | ThinkingContent )[] = [];
	const partialAssistant = (): AssistantMessage => ( {
		role: 'assistant',
		content: [ ...content ],
		api: 'anthropic-messages',
		provider: ACP_PROVIDER_NAME,
		model: 'claude-code',
		usage: ZERO_USAGE,
		stopReason: 'stop',
		timestamp: now(),
	} );
	const runningToolCalls = new Set< string >();

	const appendChunk = ( kind: 'text' | 'thinking', delta: string ) => {
		const last = content[ content.length - 1 ];
		let contentIndex = content.length - 1;
		if ( ! last || last.type !== kind ) {
			content.push(
				kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }
			);
			contentIndex = content.length - 1;
			emit( {
				type: 'message_update',
				message: partialAssistant(),
				assistantMessageEvent:
					kind === 'text'
						? { type: 'text_start', contentIndex, partial: partialAssistant() }
						: { type: 'thinking_start', contentIndex, partial: partialAssistant() },
			} );
		}
		const block = content[ contentIndex ];
		if ( block.type === 'text' ) {
			block.text += delta;
		} else {
			block.thinking += delta;
		}
		emit( {
			type: 'message_update',
			message: partialAssistant(),
			assistantMessageEvent:
				kind === 'text'
					? { type: 'text_delta', contentIndex, delta, partial: partialAssistant() }
					: { type: 'thinking_delta', contentIndex, delta, partial: partialAssistant() },
		} );
	};

	const handleToolCallUpdate = ( update: ToolCallUpdate & { sessionUpdate?: string } ) => {
		const toolCallId = update.toolCallId;
		const toolName = update.title ?? update.kind ?? 'tool';
		// The initial `tool_call` notification may omit `status`; treat it as
		// pending so the start of the call is still surfaced.
		const status = update.status ?? 'pending';
		if ( status === 'pending' || status === 'in_progress' ) {
			if ( ! runningToolCalls.has( toolCallId ) ) {
				runningToolCalls.add( toolCallId );
				emit( {
					type: 'tool_execution_start',
					toolCallId,
					toolName,
					args: update.rawInput ?? {},
				} );
			}
			return;
		}
		if ( status === 'completed' || status === 'failed' ) {
			runningToolCalls.delete( toolCallId );
			emit( {
				type: 'tool_execution_end',
				toolCallId,
				toolName,
				result: update.rawOutput ?? update.content ?? null,
				isError: status === 'failed',
			} );
		}
	};

	const client: Client = {
		// Tool use is auto-approved for the PoC, scoped by the session cwd —
		// same trust level as the pi tools, which don't prompt either.
		requestPermission( params: RequestPermissionRequest ): RequestPermissionResponse {
			const options = params.options ?? [];
			const preferred =
				options.find( ( option ) => option.kind === 'allow_always' ) ??
				options.find( ( option ) => option.kind === 'allow_once' ) ??
				options[ 0 ];
			if ( ! preferred ) {
				return { outcome: { outcome: 'cancelled' } };
			}
			return { outcome: { outcome: 'selected', optionId: preferred.optionId } };
		},
		sessionUpdate( params: SessionNotification ): void {
			const update = params.update;
			switch ( update.sessionUpdate ) {
				case 'agent_message_chunk':
					if ( update.content.type === 'text' ) {
						appendChunk( 'text', update.content.text );
					}
					break;
				case 'agent_thought_chunk':
					if ( update.content.type === 'text' ) {
						appendChunk( 'thinking', update.content.text );
					}
					break;
				case 'tool_call':
				case 'tool_call_update':
					handleToolCallUpdate( update );
					break;
				default:
					break;
			}
		},
	};

	const adapterEntry = resolveAdapterEntry();
	const child = spawn( process.execPath, [ adapterEntry ], {
		env,
		cwd,
		stdio: [ 'pipe', 'pipe', 'pipe' ],
	} );
	state.child = child;

	let stderrTail = '';
	child.stderr?.on( 'data', ( chunk: Buffer ) => {
		stderrTail = ( stderrTail + chunk.toString() ).slice( -2000 );
	} );

	const spawnFailure = new Promise< never >( ( _resolve, reject ) => {
		child.once( 'error', ( error ) =>
			reject(
				new Error( `${ __( 'Failed to start the Claude Code ACP adapter.' ) } ${ error.message }` )
			)
		);
	} );

	try {
		const stream = ndJsonStream(
			Writable.toWeb( child.stdin! ) as WritableStream< Uint8Array >,
			Readable.toWeb( child.stdout! ) as ReadableStream< Uint8Array >
		);
		const connection = new ClientSideConnection( () => client, stream );
		state.connection = connection;

		await Promise.race( [
			( async () => {
				await connection.initialize( {
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
					clientInfo: { name: 'wordpress-studio', version: __STUDIO_CLI_VERSION__ },
				} );

				const newSession = await connection.newSession( {
					cwd,
					mcpServers: [
						{
							name: 'wordpress-studio',
							command: process.execPath,
							args: [ process.argv[ 1 ], 'mcp' ],
							env: [],
						},
					],
				} );
				state.acpSessionId = newSession.sessionId;

				emit( { type: 'agent_start' } );
				emit( { type: 'turn_start' } );
				sm.appendMessage( userMessage );
				emit( { type: 'message_start', message: userMessage } );
				emit( { type: 'message_end', message: userMessage } );
				emit( { type: 'message_start', message: partialAssistant() } );

				const promptResponse = await connection.prompt( {
					sessionId: newSession.sessionId,
					prompt: [ { type: 'text', text: config.prompt } ],
				} );

				const stopReason = mapAcpStopReason( promptResponse.stopReason, state.interrupted );
				const assistantMessage: AssistantMessage = {
					...partialAssistant(),
					stopReason,
					...( stopReason === 'error'
						? { errorMessage: __( 'Claude declined to answer this request.' ) }
						: {} ),
				};

				sm.appendMessage( assistantMessage );
				emit( { type: 'message_end', message: assistantMessage } );
				emit( { type: 'turn_end', message: assistantMessage, toolResults: [] } );
				emit( {
					type: 'agent_end',
					messages: [ userMessage, assistantMessage ],
					willRetry: false,
				} );
			} )(),
			spawnFailure,
		] );
	} catch ( error ) {
		if ( state.interrupted ) {
			const abortedMessage: AssistantMessage = { ...partialAssistant(), stopReason: 'aborted' };
			sm.appendMessage( abortedMessage );
			emit( { type: 'message_end', message: abortedMessage } );
			emit( {
				type: 'agent_end',
				messages: [ userMessage, abortedMessage ],
				willRetry: false,
			} );
			return;
		}
		const details = stderrTail.trim();
		throw error instanceof Error && details
			? new Error( `${ error.message }\n${ details }` )
			: error;
	} finally {
		if ( ! child.killed ) {
			child.kill( 'SIGTERM' );
		}
	}
}
