import { type ChildProcess, spawn } from 'child_process';
import readline from 'readline';
import type { JsonEvent, TurnCompletedStatus } from '@studio/common/ai/json-events';

export interface QuestionAsked {
	question: string;
	options: Array< { label: string; description: string } >;
}

export type TurnOutcomeStatus = TurnCompletedStatus | 'timeout' | 'spawn_error';

export interface TurnOutcome {
	status: TurnOutcomeStatus;
	sessionId?: string;
	/** `result` field from the SDK result event, or error text assembled from `errors[]`. */
	replyText?: string;
	/** Flattened question + options when the turn ends with a paused AskUserQuestion. */
	questions?: QuestionAsked[];
	/** True when the underlying SDK result had `is_error: true`. */
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

interface SdkResultLike {
	type?: unknown;
	subtype?: unknown;
	result?: unknown;
	session_id?: unknown;
	is_error?: unknown;
	errors?: unknown;
}

function extractResultPayload( event: Extract< JsonEvent, { type: 'message' } > ): {
	sessionId?: string;
	replyText?: string;
	isError: boolean;
} | null {
	const wrapped = event.message as SdkResultLike | null | undefined;
	if ( ! wrapped || typeof wrapped !== 'object' || wrapped.type !== 'result' ) {
		return null;
	}
	const isError = wrapped.is_error === true;
	const sessionId = typeof wrapped.session_id === 'string' ? wrapped.session_id : undefined;
	let replyText: string | undefined;
	if ( typeof wrapped.result === 'string' && wrapped.result.length > 0 ) {
		replyText = wrapped.result;
	} else if ( isError && Array.isArray( wrapped.errors ) ) {
		const msgs = ( wrapped.errors as unknown[] )
			.filter( ( e ): e is string => typeof e === 'string' )
			.join( '\n' );
		if ( msgs.length > 0 ) {
			replyText = msgs;
		}
	}
	return { sessionId, replyText, isError };
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
	isError: boolean
): boolean {
	const haystack = `${ stderrTail }\n${ lastReply ?? '' }`;
	if ( ! isError && ! STALE_SESSION_PATTERNS.some( ( r ) => r.test( haystack ) ) ) {
		return false;
	}
	return STALE_SESSION_PATTERNS.some( ( r ) => r.test( haystack ) );
}

export async function runTurn( options: TurnRunOptions ): Promise< TurnOutcome > {
	const cliEntry = options.cliEntry ?? process.argv[ 1 ];
	const execPath = options.execPath ?? process.execPath;
	const args: string[] = [ cliEntry, 'code', '--json' ];
	if ( options.sessionId ) {
		args.push( '--resume-session', options.sessionId );
	}
	// Pass the Telegram text as a positional after `--` so yargs never tries to
	// interpret anything inside it (e.g. a leading hyphen) as a flag, and so a
	// shell never sees it. Matches the `$0 [message]` command shape.
	args.push( '--', options.text );

	let child: ChildProcess;
	try {
		child = spawn( execPath, args, {
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: options.env ?? process.env,
			// Explicitly never use a shell — text is attacker-controlled.
			shell: false,
		} );
	} catch ( error ) {
		return {
			status: 'spawn_error',
			isError: true,
			stderrTail: ( error as Error ).message ?? 'spawn failed',
			exitCode: null,
			staleSession: false,
		};
	}

	let capturedSessionId: string | undefined;
	let replyText: string | undefined;
	let isError = false;
	let pausedQuestions: QuestionAsked[] | undefined;
	let completedStatus: TurnCompletedStatus | undefined;
	let stderrTail = '';
	let timedOut = false;
	let aborted = false;

	const rl = readline.createInterface( { input: child.stdout! } );
	rl.on( 'line', ( line ) => {
		const event = parseEvent( line );
		if ( ! event ) {
			return;
		}
		options.onEvent?.( event );

		if ( event.type === 'message' ) {
			const extracted = extractResultPayload( event );
			if ( extracted ) {
				if ( extracted.sessionId ) {
					capturedSessionId = extracted.sessionId;
				}
				if ( extracted.replyText ) {
					replyText = extracted.replyText;
				}
				isError = isError || extracted.isError;
			}
		} else if ( event.type === 'question.asked' ) {
			pausedQuestions = event.questions.map( ( q ) => ( {
				question: q.question,
				options: q.options.map( ( o ) => ( {
					label: o.label,
					description: o.description,
				} ) ),
			} ) );
		} else if ( event.type === 'turn.completed' ) {
			completedStatus = event.status;
			if ( event.sessionId ) {
				capturedSessionId = event.sessionId;
			}
		}
	} );

	child.stderr?.on( 'data', ( chunk: Buffer ) => {
		stderrTail = appendStderrTail( stderrTail, chunk );
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
		child.once( 'exit', ( code ) => resolve( code ) );
		child.once( 'error', () => resolve( null ) );
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

	const status: TurnOutcomeStatus = completedStatus ?? ( isError ? 'error' : 'error' );
	const staleSession =
		options.sessionId !== undefined && detectStaleSession( stderrTail, replyText, isError );

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
