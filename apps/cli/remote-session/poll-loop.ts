import { type JsonEvent } from '@studio/common/ai/json-events';
import { type RemoteSessionConfig } from 'cli/remote-session/config';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { MediaStreamer } from 'cli/remote-session/media-streamer';
import { ProgressStreamer } from 'cli/remote-session/progress-streamer';
import { chunkReply, extractReply } from 'cli/remote-session/reply-formatter';
import { clearSessionId, readStateForChat, writeSessionId } from 'cli/remote-session/state';
import {
	TelegramAuthError,
	TelegramBadRequestError,
	TelegramTransientError,
	pollMessages,
	respondMessage,
} from 'cli/remote-session/telegram-client';
import { runTurn, type TurnOutcome, type TurnRunOptions } from 'cli/remote-session/turn-runner';

/** Injected for tests. */
export interface PollLoopDeps {
	poll: typeof pollMessages;
	respond: typeof respondMessage;
	runTurn: ( options: TurnRunOptions ) => Promise< TurnOutcome >;
	readState: typeof readStateForChat;
	writeSession: typeof writeSessionId;
	clearSession: typeof clearSessionId;
	logger: RemoteSessionLogger;
	sleep: ( ms: number ) => Promise< void >;
}

const DEFAULT_DEPS: PollLoopDeps = {
	poll: pollMessages,
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

/** Where a reply should land — derived per-message from the polled payload. */
interface ReplyTarget {
	chatId: number;
	bot?: string;
}

async function postBestEffort(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	target: ReplyTarget,
	text: string
): Promise< void > {
	try {
		await deps.respond(
			config,
			{ chatId: target.chatId, bot: target.bot, text },
			{ logger: deps.logger }
		);
	} catch ( error ) {
		deps.logger.warn( 'Best-effort post failed', {
			error: ( error as Error ).message,
		} );
	}
}

async function postChunks(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	target: ReplyTarget,
	reply: string
): Promise< void > {
	const chunks = chunkReply( reply, config.max_message_chars );
	deps.logger.info( 'Posting reply', {
		chat_id: target.chatId,
		chunks: chunks.length,
		chars: reply.length,
	} );
	for ( const chunk of chunks ) {
		await deps.respond(
			config,
			{ chatId: target.chatId, bot: target.bot, text: chunk },
			{ logger: deps.logger }
		);
	}
}

async function handleTurn(
	deps: PollLoopDeps,
	config: RemoteSessionConfig,
	target: ReplyTarget,
	text: string,
	signal: AbortSignal
): Promise< void > {
	let sessionId: string | undefined = ( await deps.readState( target.chatId ) )?.session_id;
	const started = Date.now();
	const logContext = { chat_id: target.chatId };

	const progressStreamer = new ProgressStreamer( {
		config,
		target,
		deps: { respond: deps.respond, logger: deps.logger },
	} );
	const mediaStreamer = new MediaStreamer( {
		config,
		target,
		deps: { respond: deps.respond, logger: deps.logger },
	} );
	const onEvent = ( event: JsonEvent ) => {
		progressStreamer.onEvent( event );
		mediaStreamer.onEvent( event );
	};

	let outcome: TurnOutcome;
	try {
		outcome = await deps.runTurn( {
			text,
			sessionId,
			timeoutMs: config.turn_timeout_seconds * 1000,
			signal,
			logger: deps.logger,
			logContext,
			onEvent,
		} );

		if ( ! signal.aborted && outcome.staleSession && sessionId ) {
			deps.logger.info( 'Resume failed; retrying without session_id', {
				...logContext,
				stale_session_id: sessionId,
			} );
			await deps.clearSession( target.chatId );
			sessionId = undefined;
			await postBestEffort( deps, config, target, 'ℹ️ Session expired; started a new one.' );
			outcome = await deps.runTurn( {
				text,
				sessionId: undefined,
				timeoutMs: config.turn_timeout_seconds * 1000,
				signal,
				logger: deps.logger,
				logContext,
				onEvent,
			} );
		}
	} finally {
		progressStreamer.stop();
	}

	// Wait for any in-flight photos to finish posting so a text reply that
	// follows them lands in chat order, even if the photo POST is still
	// running when the turn ends.
	const mediaSummary = await mediaStreamer.drain();

	if ( outcome.sessionId && outcome.sessionId !== sessionId ) {
		await deps.writeSession( target.chatId, outcome.sessionId );
	}

	const duration = Date.now() - started;
	deps.logger.info( 'Turn finished', {
		chat_id: target.chatId,
		duration_ms: duration,
		status: outcome.status,
		exit_code: outcome.exitCode,
		chars_out: outcome.replyText?.length ?? 0,
		session_id: outcome.sessionId,
		aborted: signal.aborted,
		media_posted: mediaSummary.posted,
		media_failed: mediaSummary.failed,
	} );

	// Detach was requested mid-turn. Skip posting any reply — the detach flow
	// will announce "🔴 Local agent detached." on its own.
	if ( signal.aborted ) {
		return;
	}

	if ( outcome.status === 'timeout' ) {
		await postBestEffort( deps, config, target, '⚠️ Turn took too long; aborted.' );
		return;
	}

	if ( outcome.status === 'spawn_error' ) {
		await postBestEffort(
			deps,
			config,
			target,
			`⚠️ Local agent failed to start: ${ truncate( outcome.stderrTail, 400 ) }`
		);
		return;
	}

	if ( outcome.exitCode !== null && outcome.exitCode !== 0 && ! outcome.replyText ) {
		const stderrSnippet = outcome.stderrTail ? truncate( outcome.stderrTail, 500 ) : '';
		const message = stderrSnippet
			? `⚠️ Local agent error: ${ stderrSnippet }`
			: '⚠️ Local agent error (no output).';
		await postBestEffort( deps, config, target, message );
		return;
	}

	const reply = extractReply( {
		replyText: outcome.replyText,
		questions: outcome.questions,
		isError: outcome.isError,
	} );

	const deliveredMedia = mediaSummary.posted > 0;

	if ( reply === null && ! deliveredMedia ) {
		await postBestEffort( deps, config, target, '⚠️ Local agent did not return a result.' );
		return;
	}

	if ( reply !== null ) {
		await postChunks( deps, config, target, reply );
	}
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

	// Attach status is only posted when the user pinned a `chat_id` in config. Without
	// it, we don't know where to post until the first message arrives.
	if ( config.chat_id !== undefined ) {
		const state = await deps.readState( config.chat_id );
		const resuming = Boolean( state?.session_id );
		const cwd = options.cwd ?? process.cwd();
		const attachMessage = `🟢 Local agent attached. Working dir: ${ cwd }. ${
			resuming ? 'Resuming previous session.' : 'New session.'
		}`;
		await deps.respond(
			config,
			{
				chatId: config.chat_id,
				bot: config.bot,
				text: attachMessage,
			},
			{ logger: deps.logger }
		);
		deps.logger.info( 'Attached (pinned chat)', { chat_id: config.chat_id, resuming } );
	} else {
		deps.logger.info( 'Attached (open to any chat authorized by the bearer)' );
	}
	options.onAttached?.();

	const announceDetach = async ( reason: string ) => {
		if ( detachAnnounced ) {
			return;
		}
		detachAnnounced = true;
		deps.logger.info( 'Detaching', { reason } );
		// Detach status is also only posted when chat_id is pinned.
		if ( config.chat_id !== undefined ) {
			await postBestEffort(
				deps,
				config,
				{ chatId: config.chat_id, bot: config.bot },
				'🔴 Local agent detached.'
			);
		}
	};

	const detach = async () => {
		detachRequested = true;
		abortController.abort();
		await announceDetach( 'requested' );
	};

	const loop = async (): Promise< void > => {
		let backoffAttempt = 0;
		batchLoop: while ( ! detachRequested ) {
			let batch: Awaited< ReturnType< typeof deps.poll > >;
			try {
				batch = await deps.poll( config, abortController.signal, { logger: deps.logger } );
				backoffAttempt = 0;
			} catch ( error ) {
				if ( error instanceof TelegramAuthError ) {
					deps.logger.error( 'Auth error; detaching', { status: error.status } );
					if ( config.chat_id !== undefined ) {
						await postBestEffort(
							deps,
							config,
							{ chatId: config.chat_id, bot: config.bot },
							'⚠️ Bad token; detaching.'
						);
					}
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

			if ( batch.length === 0 ) {
				await deps.sleep( config.poll_interval_seconds * 1000 );
				continue;
			}

			// Drain the batch sequentially. One message = one `studio code --json` turn.
			for ( const polled of batch ) {
				if ( detachRequested ) {
					break batchLoop;
				}

				// Only filter by chat_id when the user pinned one. Otherwise trust the
				// server's per-token authorization: any message it hands us is for us.
				if ( config.chat_id !== undefined && polled.chat_id !== config.chat_id ) {
					deps.logger.warn( 'Ignoring message for unbound chat', {
						polled_chat_id: polled.chat_id,
						bound_chat_id: config.chat_id,
					} );
					continue;
				}

				// Reply target: the chat the message came from. `bot` defaults to the
				// polled bot, unless config pins one.
				const target: ReplyTarget = {
					chatId: polled.chat_id,
					bot: config.bot ?? polled.bot,
				};

				const text = polled.text.trim();
				deps.logger.info( 'Polled message', {
					chat_id: polled.chat_id,
					bot: polled.bot,
					text_length: polled.text.length,
					preview: text.slice( 0, 80 ),
				} );

				if ( text.length === 0 ) {
					// Empty text would cause `studio code --json` to fail its `.check()`
					// and emit yargs help on stderr. Skip and tell the user.
					deps.logger.warn( 'Skipping empty message', {
						chat_id: polled.chat_id,
					} );
					await postBestEffort(
						deps,
						config,
						target,
						'⚠️ Empty message ignored. Send some text or `/new` to start over.'
					);
					continue;
				}

				if ( text.toLowerCase() === '/new' ) {
					await deps.clearSession( polled.chat_id );
					try {
						await deps.respond(
							config,
							{
								chatId: target.chatId,
								bot: target.bot,
								text: '🆕 Started a new conversation.',
							},
							{ logger: deps.logger }
						);
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
					await handleTurn( deps, config, target, polled.text, abortController.signal );
				} catch ( error ) {
					if ( error instanceof TelegramAuthError ) {
						deps.logger.error( 'Auth error during respond; detaching', {
							status: error.status,
						} );
						detachRequested = true;
						process.exitCode = 1;
						break batchLoop;
					}
					if ( error instanceof TelegramBadRequestError ) {
						deps.logger.warn( 'Respond 4xx; dropping chunk', { status: error.status } );
						continue;
					}
					deps.logger.error( 'Turn failed', { error: ( error as Error ).message } );
					await postBestEffort(
						deps,
						config,
						target,
						`⚠️ Local agent error: ${ truncate( ( error as Error ).message, 500 ) }`
					);
				}
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
