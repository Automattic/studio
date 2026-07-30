import { type ChildProcess, spawn } from 'child_process';
import readline from 'readline';
import { findLastAssistant } from '@studio/common/ai/session-events';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { JsonEvent, TurnCompletedStatus } from '@studio/common/ai/json-events';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

export interface QuestionAsked {
	question: string;
	options: Array< { label: string; description: string } >;
}

export type TurnOutcomeStatus = TurnCompletedStatus | 'timeout' | 'spawn_error';

export interface TurnOutcome {
	status: TurnOutcomeStatus;
	sessionId?: string;
	/** Last assistant text from the terminal `agent_end`, or the message's
	 * `errorMessage` when the turn errored without producing text. */
	replyText?: string;
	/** Flattened question + options when the turn ends with a paused AskUserQuestion. */
	questions?: QuestionAsked[];
	/** True when the last assistant message's `stopReason` was `error` or `aborted`. */
	isError: boolean;
	/** Last ~2KB of stderr output from the child. */
	stderrTail: string;
	/** Exit code from the child process (undefined if we killed it). */
	exitCode: number | null;
	/** True when we detect the child rejected --resume-session <id> and the caller should retry. */
	staleSession: boolean;
}

export interface TurnRunOptions {
	text: string;
	sessionId?: string;
	timeoutMs: number;
	/** Path to the CLI entry file. Defaults to process.argv[1]. */
	cliEntry?: string;
	/** Node executable. Defaults to process.execPath. */
	execPath?: string;
	/** Optional env overrides. */
	env?: NodeJS.ProcessEnv;
	/** Hook for tests to observe raw events as they arrive. */
	onEvent?: ( event: JsonEvent ) => void;
	/** Abort the turn (kills the child). */
	signal?: AbortSignal;
	/** Optional logger for subprocess lifecycle diagnostics. */
	logger?: RemoteSessionLogger;
	/** Correlates log lines with the originating chat/message. */
	logContext?: Record< string, unknown >;
}

const STDERR_TAIL_BYTES = 2048;
const POST_COMPLETE_EXIT_GRACE_MS = 5000;
const SIGKILL_GRACE_MS = 2000;

/** Loose signals that `--resume-session <id>` failed. Confirmed empirically in phase 0. */
const STALE_SESSION_PATTERNS = [
	/no ai session found for resume id/i,
	/session.*(not.?found|invalid|expired|unknown)/i,
	/resume.*session.*(failed|invalid)/i,
];

// The CLI wraps native pi `AgentSessionEvent` payloads inside the `'message'`
// envelope; `agent_end` is the terminal event carrying the full message tail.
// Pull the last assistant message's text + error state from there.
interface PiAgentMessageLike {
	role?: unknown;
	content?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
	toolName?: unknown;
	isError?: unknown;
}

interface PiContentBlockLike {
	type?: unknown;
	text?: unknown;
	name?: unknown;
	arguments?: unknown;
	input?: unknown;
}

const STEP_TEXT_PREVIEW_CHARS = 200;
const STEP_INPUT_PREVIEW_CHARS = 120;

function previewToolInput( input: unknown ): string {
	if ( ! input || typeof input !== 'object' ) {
		return '';
	}
	let json: string;
	try {
		json = JSON.stringify( input );
	} catch {
		return '';
	}
	const oneLine = json.replace( /\s+/g, ' ' );
	return oneLine.length > STEP_INPUT_PREVIEW_CHARS
		? `${ oneLine.slice( 0, STEP_INPUT_PREVIEW_CHARS - 1 ) }…`
		: oneLine;
}

/**
 * Extract concatenated text from a native pi assistant message. Used as a
 * fallback if the terminal `agent_end` arrives without final text.
 */
function extractAssistantText( raw: AgentMessage ): string {
	const message = raw as PiAgentMessageLike;
	if ( ! message || typeof message !== 'object' || message.role !== 'assistant' ) {
		return '';
	}
	const blocks = message.content;
	if ( ! Array.isArray( blocks ) ) {
		return '';
	}
	const parts: string[] = [];
	for ( const block of blocks as PiContentBlockLike[] ) {
		if (
			block &&
			typeof block === 'object' &&
			block.type === 'text' &&
			typeof block.text === 'string'
		) {
			parts.push( block.text );
		}
	}
	return parts.join( '' ).trim();
}

/**
 * Extract a short, human-readable summary of a native pi message or tool event
 * for logging to the remote-session log file. Returns one line per content
 * block (text snippet, tool call name+input preview, tool result error flag).
 * Empty array when the message has no useful content to summarize.
 */
function summarizeAgentMessage( raw: AgentMessage ): string[] {
	const message = raw as PiAgentMessageLike;
	if ( ! message || typeof message !== 'object' ) {
		return [];
	}
	const role = typeof message.role === 'string' ? message.role : '';
	if ( role !== 'assistant' && role !== 'user' && role !== 'toolResult' ) {
		return [];
	}

	if ( role === 'toolResult' ) {
		const name = typeof message.toolName === 'string' ? message.toolName : '<unknown>';
		const errFlag = message.isError === true ? ' (error)' : '';
		return [ `tool_result: ${ name }${ errFlag }` ];
	}

	const blocks = message.content;
	const lines: string[] = [];
	if ( typeof blocks === 'string' ) {
		const snippet = blocks.replace( /\s+/g, ' ' ).trim();
		if ( snippet.length > 0 ) {
			lines.push( `text: ${ truncatePreview( snippet, STEP_TEXT_PREVIEW_CHARS ) }` );
		}
		return lines;
	}
	if ( ! Array.isArray( blocks ) ) {
		return [];
	}
	for ( const block of blocks as PiContentBlockLike[] ) {
		if ( ! block || typeof block !== 'object' ) {
			continue;
		}
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			const snippet = block.text.replace( /\s+/g, ' ' ).trim();
			if ( snippet.length === 0 ) {
				continue;
			}
			lines.push( `text: ${ truncatePreview( snippet, STEP_TEXT_PREVIEW_CHARS ) }` );
		} else if ( block.type === 'toolCall' ) {
			const name = typeof block.name === 'string' ? block.name : '<unknown>';
			const inputPreview = previewToolInput( block.arguments );
			lines.push(
				inputPreview ? `tool_call: ${ name } ${ inputPreview }` : `tool_call: ${ name }`
			);
		} else if ( block.type === 'thinking' ) {
			lines.push( 'thinking' );
		}
	}
	return lines;
}

function summarizeMessageContent( event: AgentSessionEvent ): string[] {
	if ( event.type === 'message_end' ) {
		return summarizeAgentMessage( event.message );
	}
	if ( event.type === 'tool_execution_start' ) {
		const name = typeof event.toolName === 'string' ? event.toolName : '<unknown>';
		const inputPreview = previewToolInput( event.args );
		return [ inputPreview ? `tool_call: ${ name } ${ inputPreview }` : `tool_call: ${ name }` ];
	}
	if ( event.type === 'tool_execution_end' ) {
		const name = typeof event.toolName === 'string' ? event.toolName : '<unknown>';
		const errFlag = event.isError === true ? ' (error)' : '';
		return [ `tool_result: ${ name }${ errFlag }` ];
	}
	return [];
}

function extractAssistantTextFromEvent( event: AgentSessionEvent ): string {
	if ( event.type !== 'message_end' ) {
		return '';
	}
	return extractAssistantText( event.message );
}

function truncatePreview( text: string, maxLength: number ): string {
	return text.length > maxLength ? `${ text.slice( 0, maxLength - 1 ) }…` : text;
}

function extractResultPayload( event: Extract< JsonEvent, { type: 'message' } > ): {
	replyText?: string;
	isError: boolean;
	stopReason?: string | null;
} | null {
	const wrapped = event.message;
	if ( wrapped.type !== 'agent_end' ) {
		return null;
	}
	const lastAssistant = findLastAssistant( wrapped.messages );
	if ( ! lastAssistant ) {
		return { isError: false };
	}

	const isError = lastAssistant.stopReason === 'error' || lastAssistant.stopReason === 'aborted';
	const stopReason =
		typeof lastAssistant.stopReason === 'string' || lastAssistant.stopReason === null
			? ( lastAssistant.stopReason as string | null )
			: undefined;

	let replyText: string | undefined;
	if ( Array.isArray( lastAssistant.content ) ) {
		const text = ( lastAssistant.content as PiContentBlockLike[] )
			.filter( ( b ) => b?.type === 'text' && typeof b.text === 'string' )
			.map( ( b ) => b.text as string )
			.join( '\n' )
			.trim();
		if ( text.length > 0 ) replyText = text;
	}
	if ( ! replyText && typeof lastAssistant.errorMessage === 'string' ) {
		const trimmed = lastAssistant.errorMessage.trim();
		if ( trimmed.length > 0 ) replyText = trimmed;
	}
	return { replyText, isError, stopReason };
}

function parseEvent( line: string ): JsonEvent | null {
	const trimmed = line.trim();
	if ( ! trimmed ) {
		return null;
	}
	try {
		const parsed = JSON.parse( trimmed ) as JsonEvent;
		if ( parsed && typeof parsed === 'object' && typeof parsed.type === 'string' ) {
			return parsed;
		}
	} catch {
		// Malformed JSON line — ignore. Happens if a tool writes to stdout directly.
	}
	return null;
}

function appendStderrTail( current: string, chunk: Buffer ): string {
	const combined = current + chunk.toString( 'utf8' );
	if ( combined.length <= STDERR_TAIL_BYTES ) {
		return combined;
	}
	return combined.slice( combined.length - STDERR_TAIL_BYTES );
}

function detectStaleSession(
	stderrTail: string,
	lastReply: string | undefined,
	errorEventMessage: string | undefined
): boolean {
	const haystack = [ stderrTail, lastReply, errorEventMessage ].filter( Boolean ).join( '\n' );
	return STALE_SESSION_PATTERNS.some( ( r ) => r.test( haystack ) );
}

export async function runTurn( options: TurnRunOptions ): Promise< TurnOutcome > {
	const cliEntry = options.cliEntry ?? process.argv[ 1 ];
	const execPath = options.execPath ?? process.execPath;
	// Send the Telegram text on stdin (`--message-from-stdin`) rather than as a
	// positional. Avoids both yargs's `--` separator dropping the positional and
	// any chance of attacker-controlled text being parsed as a flag.
	const args: string[] = [ cliEntry, 'code', '--json', '--message-from-stdin' ];
	if ( options.sessionId ) {
		args.push( '--resume-session', options.sessionId );
	}

	const logger = options.logger;
	const logContext = options.logContext ?? {};
	const startedAt = Date.now();
	logger?.info( 'Spawning studio code subprocess', {
		...logContext,
		exec: execPath,
		cli_entry: cliEntry,
		has_resume_session: options.sessionId !== undefined,
		session_id: options.sessionId,
		text_length: options.text.length,
		text_preview: options.text.slice( 0, 120 ),
		timeout_ms: options.timeoutMs,
	} );

	// Tell the spawned `studio code --json` it's running in a remote session so the
	// system prompt can lean on `share_screenshot` and the preview-site follow-up.
	const childEnv: NodeJS.ProcessEnv = {
		...( options.env ?? process.env ),
		STUDIO_REMOTE_SESSION: '1',
	};

	let child: ChildProcess;
	try {
		child = spawn( execPath, args, {
			stdio: [ 'pipe', 'pipe', 'pipe' ],
			env: childEnv,
			// Explicitly never use a shell — text is attacker-controlled.
			shell: false,
		} );
	} catch ( error ) {
		const message = ( error as Error ).message ?? 'spawn failed';
		logger?.error( 'Spawn failed', { ...logContext, error: message } );
		return {
			status: 'spawn_error',
			isError: true,
			stderrTail: message,
			exitCode: null,
			staleSession: false,
		};
	}

	logger?.debug( 'Subprocess spawned', { ...logContext, pid: child.pid } );

	if ( child.stdin ) {
		child.stdin.on( 'error', ( error ) => {
			logger?.warn( 'Subprocess stdin error', { ...logContext, error: error.message } );
		} );
		child.stdin.end( options.text, 'utf8' );
	}

	let capturedSessionId: string | undefined;
	let replyText: string | undefined;
	let isError = false;
	let pausedQuestions: QuestionAsked[] | undefined;
	let completedStatus: TurnCompletedStatus | undefined;
	let stderrTail = '';
	let timedOut = false;
	let aborted = false;
	const eventCounts: Record< string, number > = {};
	let agentEndEventSeen = false;
	let agentEndEventEmptyReply = false;
	let nonJsonStdoutLines = 0;
	let lastAssistantText = '';
	let usedAssistantTextFallback = false;
	let lastErrorEventMessage: string | undefined;

	const rl = readline.createInterface( { input: child.stdout! } );
	rl.on( 'line', ( line ) => {
		const event = parseEvent( line );
		if ( ! event ) {
			if ( line.trim().length > 0 ) {
				nonJsonStdoutLines++;
				logger?.debug( 'Subprocess stdout (non-JSON)', {
					...logContext,
					line: line.slice( 0, 500 ),
				} );
			}
			return;
		}
		eventCounts[ event.type ] = ( eventCounts[ event.type ] ?? 0 ) + 1;
		options.onEvent?.( event );

		if ( event.type === 'progress' || event.type === 'info' ) {
			logger?.event( event.type, event.message );
		} else if ( event.type === 'error' ) {
			lastErrorEventMessage = event.message;
			logger?.event( 'error', event.message );
		}

		if ( event.type === 'message' ) {
			const extracted = extractResultPayload( event );
			if ( ! extracted ) {
				const stepLines = summarizeMessageContent( event.message );
				for ( const line of stepLines ) {
					logger?.event( 'agent.step', line );
				}
				const assistantText = extractAssistantTextFromEvent( event.message );
				if ( assistantText ) {
					lastAssistantText = assistantText;
				}
			}
			if ( extracted ) {
				agentEndEventSeen = true;
				if ( extracted.replyText ) {
					replyText = extracted.replyText;
					logger?.event( extracted.isError ? 'reply.error' : 'reply', extracted.replyText );
				} else {
					agentEndEventEmptyReply = true;
					logger?.warn( 'agent_end event had empty reply', {
						...logContext,
						is_error: extracted.isError,
						stop_reason: extracted.stopReason,
					} );
				}
				isError = isError || extracted.isError;
				logger?.debug( 'Event: message/agent_end', {
					...logContext,
					is_error: extracted.isError,
					result_chars: extracted.replyText?.length ?? 0,
				} );
			} else {
				logger?.debug( 'Event: message', { ...logContext } );
			}
		} else if ( event.type === 'question.asked' ) {
			pausedQuestions = event.questions.map( ( q ) => ( {
				question: q.question,
				options: q.options.map( ( o ) => ( {
					label: o.label,
					description: o.description,
				} ) ),
			} ) );
			for ( const q of pausedQuestions ) {
				const optionLines = q.options
					.map( ( o ) => `  - ${ o.label }: ${ o.description }` )
					.join( '\n' );
				logger?.event( 'question', `${ q.question }\n${ optionLines }` );
			}
			logger?.debug( 'Event: question.asked', {
				...logContext,
				questions: pausedQuestions.length,
			} );
		} else if ( event.type === 'turn.completed' ) {
			completedStatus = event.status;
			if ( event.sessionId ) {
				capturedSessionId = event.sessionId;
			}
			logger?.debug( 'Event: turn.completed', {
				...logContext,
				status: event.status,
				session_id: event.sessionId,
			} );
		} else {
			logger?.debug( 'Event', { ...logContext, type: event.type } );
		}
	} );

	child.stderr?.on( 'data', ( chunk: Buffer ) => {
		stderrTail = appendStderrTail( stderrTail, chunk );
		const text = chunk.toString( 'utf8' );
		if ( text.trim().length > 0 ) {
			logger?.debug( 'Subprocess stderr', {
				...logContext,
				chunk: text.slice( 0, 500 ),
			} );
		}
	} );

	const overallTimer = setTimeout( () => {
		timedOut = true;
		killChild( child );
	}, options.timeoutMs );

	const onAbort = () => {
		aborted = true;
		killChild( child );
	};
	options.signal?.addEventListener( 'abort', onAbort, { once: true } );

	const exitCode = await new Promise< number | null >( ( resolve ) => {
		child.once( 'exit', ( code, signal ) => {
			logger?.info( 'Subprocess exited', {
				...logContext,
				exit_code: code,
				signal,
				duration_ms: Date.now() - startedAt,
			} );
			resolve( code );
		} );
		child.once( 'error', ( error ) => {
			logger?.error( 'Subprocess error', { ...logContext, error: error.message } );
			resolve( null );
		} );
	} );

	clearTimeout( overallTimer );
	options.signal?.removeEventListener( 'abort', onAbort );
	rl.close();

	if ( aborted ) {
		// Caller initiated — surface as timeout so the poll loop doesn't post a reply.
		return {
			status: 'timeout',
			sessionId: capturedSessionId,
			replyText,
			questions: pausedQuestions,
			isError: true,
			stderrTail,
			exitCode,
			staleSession: false,
		};
	}

	if ( timedOut ) {
		return {
			status: 'timeout',
			sessionId: capturedSessionId,
			replyText,
			questions: pausedQuestions,
			isError: true,
			stderrTail,
			exitCode,
			staleSession: false,
		};
	}

	// If `agent_end` arrives without final text but we saw an assistant
	// `message_end` earlier in the turn, surface that text instead of posting
	// "did not return a result" to the user.
	if (
		agentEndEventEmptyReply &&
		! isError &&
		replyText === undefined &&
		lastAssistantText.length > 0
	) {
		replyText = lastAssistantText;
		usedAssistantTextFallback = true;
		logger?.warn( 'Using last assistant text as reply (empty agent_end)', {
			...logContext,
			fallback_chars: lastAssistantText.length,
		} );
	}

	const status: TurnOutcomeStatus = completedStatus ?? 'error';
	const staleSession =
		options.sessionId !== undefined &&
		detectStaleSession( stderrTail, replyText, lastErrorEventMessage );

	logger?.info( 'Turn outcome', {
		...logContext,
		status,
		session_id: capturedSessionId,
		exit_code: exitCode,
		is_error: isError,
		reply_chars: replyText?.length ?? 0,
		questions: pausedQuestions?.length ?? 0,
		stale_session: staleSession,
		stderr_tail: stderrTail ? stderrTail.slice( -500 ) : '',
		event_counts: eventCounts,
		agent_end_event_seen: agentEndEventSeen,
		agent_end_event_empty_reply: agentEndEventEmptyReply,
		non_json_stdout_lines: nonJsonStdoutLines,
		turn_completed_seen: completedStatus !== undefined,
		used_assistant_text_fallback: usedAssistantTextFallback,
	} );

	return {
		status,
		sessionId: capturedSessionId,
		replyText,
		questions: pausedQuestions,
		isError,
		stderrTail,
		exitCode,
		staleSession,
	};
}

function killChild( child: ChildProcess ): void {
	if ( child.exitCode !== null || child.signalCode ) {
		return;
	}
	try {
		child.kill( 'SIGTERM' );
	} catch {
		// ignore
	}
	setTimeout( () => {
		if ( child.exitCode === null && ! child.signalCode ) {
			try {
				child.kill( 'SIGKILL' );
			} catch {
				// ignore
			}
		}
	}, SIGKILL_GRACE_MS );
}

// Exported for tests that want to simulate the post-`turn.completed` grace window.
export const TURN_RUNNER_INTERNALS = {
	POST_COMPLETE_EXIT_GRACE_MS,
	SIGKILL_GRACE_MS,
	STDERR_TAIL_BYTES,
};
