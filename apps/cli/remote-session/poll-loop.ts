import { type JsonEvent } from '@studio/common/ai/json-events';
import { bumpStat } from 'cli/lib/bump-stat';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';
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
	/**
	 * Whether to emit Dolly bump stats (attach/turn/detach). Defaults to false so tests don't
	 * accidentally bump. The CLI entry point sets this to true when the bundle has telemetry
	 * compiled in and the user didn't pass `--avoid-telemetry`.
	 */
	telemetryEnabled?: boolean;
}

function turnStatusMetric( outcomeStatus: TurnOutcome[ 'status' ] ): StatsMetric {
	switch ( outcomeStatus ) {
		case 'success':
			return StatsMetric.SUCCESS;
		case 'error':
			return StatsMetric.TURN_ERROR;
		case 'paused':
			return StatsMetric.TURN_PAUSED;
		case 'max_turns':
			return StatsMetric.TURN_MAX_TURNS;
		case 'timeout':
			return StatsMetric.TURN_TIMEOUT;
		case 'spawn_error':
			return StatsMetric.TURN_SPAWN_ERROR;
	}
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
	signal: AbortSignal,
	telemetryEnabled: boolean
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

	// Definite-assignment: runTurn never throws synchronously (it surfaces
	// errors via outcome.status = 'spawn_error'), so by the time the finally
	// block runs `outcome` is always defined in practice. The `!` lets TS see
	// the optional-chain read in finally without losing strictness elsewhere.
	let outcome!: TurnOutcome;
	let mediaSummary = { posted: 0, failed: 0 };
	// Populated inside try and consumed inside finally; pulled into scope so
	// the finally block can decide between folding the reply into the live
	// status (`replaceWithReply`) or finalizing with a ✅/⚠️ summary.
	let replyForAbsorb: string | null = null;
	let absorbedReply = false;
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
		// Compute the final reply text early so the finally block can decide
		// whether to absorb it into the live status message (replaceWithReply)
		// or fall through to the regular `stop()` + `postChunks` path.
		replyForAbsorb =
			outcome && ! signal.aborted && outcome.status === 'success' && outcome.exitCode === 0
				? extractReply( {
						replyText: outcome.replyText,
						questions: outcome.questions,
						isError: outcome.isError,
				  } )
				: null;
	} finally {
		// Drain in-flight photos BEFORE finalizing the live status so any
		// mid-turn photo POSTs (which post as new messages) land first and the
		// chat sequence stays in order.
		mediaSummary = await mediaStreamer.drain();

		// If we have a short single-message reply, fold it into the live status
		// in place. Avoids a redundant "✅ Done" line above the real reply, and
		// avoids the "🗑 deleted" tombstone some clients (e.g. Beeper) render
		// for deletions. The `replyForAbsorb` guard already filters to clean
		// success turns; the length check covers reply > one Telegram message.
		if (
			replyForAbsorb !== null &&
			replyForAbsorb.length <= config.max_message_chars &&
			mediaSummary.posted === 0
		) {
			absorbedReply = await progressStreamer.replaceWithReply( replyForAbsorb );
		}

		if ( ! absorbedReply ) {
			// Either no reply, reply too long, media-only turn, or an error
			// status — finalize the status with a ✅/⚠️ summary instead.
			// `signal.aborted` means the user detached mid-turn — treat as error.
			// `undefined` (runTurn threw before assigning) leaves the line.
			const finalStatus = signal.aborted ? 'error' : outcome?.status;
			await progressStreamer.stop( finalStatus );
		}
	}

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
		reply_absorbed: absorbedReply,
	} );

	if ( telemetryEnabled ) {
		// `aborted` means the user detached mid-turn — the outcome status will still be 'error' or
		// similar, but the meaningful classification is "user-initiated cancel," so bucket it
		// separately to avoid skewing the error rate.
		bumpStat(
			StatsGroup.STUDIO_CLI_DOLLY_TURN,
			signal.aborted ? StatsMetric.TURN_ABORTED : turnStatusMetric( outcome.status )
		);
	}

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

	if ( absorbedReply ) {
		// `replaceWithReply` already landed the reply in the live-status
		// message — nothing left to post.
		return;
	}

	const reply = extractReply( {
		replyText: outcome.replyText,
		questions: outcome.questions,
		isError: outcome.isError,
	} );

	const deliveredMedia = mediaSummary.posted > 0;

	if ( reply === null && ! deliveredMedia ) {
		deps.logger.warn( 'No reply produced; posting fallback', {
			chat_id: target.chatId,
			status: outcome.status,
			exit_code: outcome.exitCode,
			is_error: outcome.isError,
			reply_text_chars: outcome.replyText?.length ?? 0,
			questions: outcome.questions?.length ?? 0,
			stderr_tail: outcome.stderrTail ? outcome.stderrTail.slice( -500 ) : '',
		} );
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
	const telemetryEnabled = options.telemetryEnabled ?? false;

	const abortController = new AbortController();
	let detachRequested = false;
	let detachAnnounced = false;
	// When set, takes precedence over the `reason` arg in `announceDetach`. Error paths assign
	// here so the detach bump distinguishes auth-error / fatal-poll-error from a clean exit,
	// even though they all funnel through the same break-batchLoop → 'loop-exit' code path.
	let pendingDetachReason: StatsMetric | undefined;

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
	if ( telemetryEnabled ) {
		bumpStat( StatsGroup.STUDIO_CLI_DOLLY_ATTACH, StatsMetric.SUCCESS );
	}
	options.onAttached?.();

	const announceDetach = async ( reason: string, detachMetric: StatsMetric ) => {
		if ( detachAnnounced ) {
			return;
		}
		detachAnnounced = true;
		deps.logger.info( 'Detaching', { reason } );
		if ( telemetryEnabled ) {
			bumpStat( StatsGroup.STUDIO_CLI_DOLLY_DETACH, pendingDetachReason ?? detachMetric );
		}
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
		await announceDetach( 'requested', StatsMetric.DETACH_REQUESTED );
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
					pendingDetachReason = StatsMetric.DETACH_AUTH_ERROR;
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
				pendingDetachReason = StatsMetric.DETACH_FATAL_POLL_ERROR;
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
				if ( text.length > 0 ) {
					deps.logger.event( 'message', text );
				}

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
					await handleTurn(
						deps,
						config,
						target,
						polled.text,
						abortController.signal,
						telemetryEnabled
					);
				} catch ( error ) {
					if ( error instanceof TelegramAuthError ) {
						deps.logger.error( 'Auth error during respond; detaching', {
							status: error.status,
						} );
						pendingDetachReason = StatsMetric.DETACH_AUTH_ERROR;
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

		await announceDetach(
			detachAnnounced ? 'already-announced' : 'loop-exit',
			StatsMetric.DETACH_LOOP_EXIT
		);
	};

	const done = loop();

	return {
		done,
		detach,
	};
}
