import { type RemoteSessionConfig } from 'cli/remote-session/config';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { chunkReply, extractReply } from 'cli/remote-session/reply-formatter';
import { clearSessionId, readStateForChat, writeSessionId } from 'cli/remote-session/state';
import {
	TelegramAuthError,
	TelegramBadRequestError,
	TelegramTransientError,
	pollMessage,
	respondMessage,
	type PolledMessage,
} from 'cli/remote-session/telegram-client';
import { runTurn, type TurnOutcome, type TurnRunOptions } from 'cli/remote-session/turn-runner';

/** Injected for tests. */
export interface PollLoopDeps {
	poll: typeof pollMessage;
	respond: typeof respondMessage;
	runTurn: ( options: TurnRunOptions ) => Promise< TurnOutcome >;
	readState: typeof readStateForChat;
	writeSession: typeof writeSessionId;
	clearSession: typeof clearSessionId;
	logger: RemoteSessionLogger;
	sleep: ( ms: number ) => Promise< void >;
}

const DEFAULT_DEPS: PollLoopDeps = {
	poll: pollMessage,
	respond: respondMessage,
	runTurn,
	readState: readStateForChat,
	writeSession: writeSessionId,
	clearSession: clearSessionId,
	logger: new RemoteSessionLogger(),
	sleep: ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) ),
};

export interface PollLoopHandle {
	/** Resolves when the loop exits. */
	done: Promise< void >;
	/** Request a graceful detach. Posts the detach status and exits the loop. */
	detach: () => Promise< void >;
}

export interface RunPollLoopOptions {
	config: RemoteSessionConfig;
	cwd?: string;
	deps?: Partial< PollLoopDeps >;
	/** Called once attach status has been posted, after entering the loop. */
	onAttached?: () => void;
}

function truncate( text: string, max: number ): string {
	return text.length > max ? `${ text.slice( 0, max - 1 ) }…` : text;
}

async function postBestEffort(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	text: string
): Promise< void > {
	try {
		await deps.respond( config, { chatId: config.chat_id, text } );
	} catch ( error ) {
		deps.logger.warn( 'Best-effort post failed', {
			error: ( error as Error ).message,
		} );
	}
}

async function postChunks(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	reply: string
): Promise< void > {
	const chunks = chunkReply( reply, config.max_message_chars );
	deps.logger.info( 'Posting reply', {
		chat_id: config.chat_id,
		chunks: chunks.length,
		chars: reply.length,
	} );
	for ( const chunk of chunks ) {
		await deps.respond( config, { chatId: config.chat_id, text: chunk } );
	}
}

async function handleTurn(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	text: string
): Promise< void > {
	let sessionId: string | undefined = ( await deps.readState( config.chat_id ) )?.session_id;
	const started = Date.now();

	let outcome = await deps.runTurn( {
		text,
		sessionId,
		timeoutMs: config.turn_timeout_seconds * 1000,
	} );

	if ( outcome.staleSession && sessionId ) {
		deps.logger.info( 'Resume failed; retrying without session_id', {
			chat_id: config.chat_id,
			stale_session_id: sessionId,
		} );
		await deps.clearSession( config.chat_id );
		sessionId = undefined;
		await postBestEffort( deps, config, 'ℹ️ Session expired; started a new one.' );
		outcome = await deps.runTurn( {
			text,
			sessionId: undefined,
			timeoutMs: config.turn_timeout_seconds * 1000,
		} );
	}

	if ( outcome.sessionId && outcome.sessionId !== sessionId ) {
		await deps.writeSession( config.chat_id, outcome.sessionId );
	}

	const duration = Date.now() - started;
	deps.logger.info( 'Turn finished', {
		chat_id: config.chat_id,
		duration_ms: duration,
		status: outcome.status,
		exit_code: outcome.exitCode,
		chars_out: outcome.replyText?.length ?? 0,
		session_id: outcome.sessionId,
	} );

	if ( outcome.status === 'timeout' ) {
		await postBestEffort( deps, config, '⚠️ Turn took too long; aborted.' );
		return;
	}

	if ( outcome.status === 'spawn_error' ) {
		await postBestEffort(
			deps,
			config,
			`⚠️ Local agent failed to start: ${ truncate( outcome.stderrTail, 400 ) }`
		);
		return;
	}

	if ( outcome.exitCode !== null && outcome.exitCode !== 0 && ! outcome.replyText ) {
		const stderrSnippet = outcome.stderrTail ? truncate( outcome.stderrTail, 500 ) : '';
		const message = stderrSnippet
			? `⚠️ Local agent error: ${ stderrSnippet }`
			: '⚠️ Local agent error (no output).';
		await postBestEffort( deps, config, message );
		return;
	}

	const reply = extractReply( {
		replyText: outcome.replyText,
		questions: outcome.questions,
		isError: outcome.isError,
	} );

	if ( reply === null ) {
		await postBestEffort( deps, config, '⚠️ Local agent did not return a result.' );
		return;
	}

	await postChunks( deps, config, reply );
}

/**
 * Run the poll/respond loop for a bound chat. Returns a handle that resolves
 * when the loop exits. Call `handle.detach()` to stop gracefully.
 */
export async function runPollLoop( options: RunPollLoopOptions ): Promise< PollLoopHandle > {
	const deps: PollLoopDeps = { ...DEFAULT_DEPS, ...options.deps };
	const { config } = options;

	const abortController = new AbortController();
	let detachRequested = false;
	let detachAnnounced = false;

	const state = await deps.readState( config.chat_id );
	const resuming = Boolean( state?.session_id );
	const cwd = options.cwd ?? process.cwd();
	const attachMessage = `🟢 Local agent attached. Working dir: ${ cwd }. ${
		resuming ? 'Resuming previous session.' : 'New session.'
	}`;

	// Attach status MUST succeed before entering the loop.
	await deps.respond( config, { chatId: config.chat_id, text: attachMessage } );
	deps.logger.info( 'Attached', { chat_id: config.chat_id, resuming } );
	options.onAttached?.();

	const announceDetach = async ( reason: string ) => {
		if ( detachAnnounced ) {
			return;
		}
		detachAnnounced = true;
		deps.logger.info( 'Detaching', { chat_id: config.chat_id, reason } );
		await postBestEffort( deps, config, '🔴 Local agent detached.' );
	};

	const detach = async () => {
		detachRequested = true;
		abortController.abort();
		await announceDetach( 'requested' );
	};

	const loop = async (): Promise< void > => {
		let backoffAttempt = 0;
		while ( ! detachRequested ) {
			let polled: PolledMessage | null;
			try {
				polled = await deps.poll( config, abortController.signal );
				backoffAttempt = 0;
			} catch ( error ) {
				if ( error instanceof TelegramAuthError ) {
					deps.logger.error( 'Auth error; detaching', { status: error.status } );
					await postBestEffort( deps, config, '⚠️ Bad token; detaching.' );
					detachRequested = true;
					process.exitCode = 1;
					break;
				}
				if ( error instanceof TelegramTransientError ) {
					const delay = Math.min( 30_000, 1000 * Math.pow( 2, backoffAttempt ) );
					deps.logger.warn( 'Transient poll error; backing off', {
						status: error.status,
						delay_ms: delay,
					} );
					backoffAttempt++;
					await deps.sleep( delay );
					continue;
				}
				if ( error instanceof Error && error.name === 'AbortError' ) {
					break;
				}
				deps.logger.error( 'Fatal poll error; detaching', {
					error: ( error as Error ).message,
				} );
				detachRequested = true;
				break;
			}

			if ( ! polled ) {
				await deps.sleep( config.poll_interval_seconds * 1000 );
				continue;
			}

			if ( polled.chat_id !== config.chat_id ) {
				deps.logger.warn( 'Ignoring message for unbound chat', {
					polled_chat_id: polled.chat_id,
					bound_chat_id: config.chat_id,
				} );
				continue;
			}

			const text = polled.text.trim();
			deps.logger.info( 'Polled message', {
				chat_id: polled.chat_id,
				preview: text.slice( 0, 80 ),
			} );

			if ( text.toLowerCase() === '/new' ) {
				await deps.clearSession( config.chat_id );
				try {
					await deps.respond( config, {
						chatId: config.chat_id,
						text: '🆕 Started a new conversation.',
					} );
				} catch ( error ) {
					if ( error instanceof TelegramBadRequestError ) {
						deps.logger.warn( 'Respond 4xx on /new ack', { status: error.status } );
					} else {
						throw error;
					}
				}
				continue;
			}

			try {
				await handleTurn( deps, config, polled.text );
			} catch ( error ) {
				if ( error instanceof TelegramAuthError ) {
					deps.logger.error( 'Auth error during respond; detaching', {
						status: error.status,
					} );
					detachRequested = true;
					process.exitCode = 1;
					break;
				}
				if ( error instanceof TelegramBadRequestError ) {
					deps.logger.warn( 'Respond 4xx; dropping chunk', { status: error.status } );
					continue;
				}
				deps.logger.error( 'Turn failed', { error: ( error as Error ).message } );
				await postBestEffort(
					deps,
					config,
					`⚠️ Local agent error: ${ truncate( ( error as Error ).message, 500 ) }`
				);
			}
		}

		await announceDetach( detachAnnounced ? 'already-announced' : 'loop-exit' );
	};

	const done = loop();

	return {
		done,
		detach,
	};
}
