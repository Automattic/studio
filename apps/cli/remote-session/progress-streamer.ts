import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';
import type { respondMessage } from 'cli/remote-session/telegram-client';

export interface ProgressTarget {
	chatId: number;
	bot?: string;
}

export interface ProgressStreamerDeps {
	respond: typeof respondMessage;
	logger: RemoteSessionLogger;
	/** Injectable for tests. Defaults to setTimeout/clearTimeout. */
	setTimeout?: ( fn: () => void, ms: number ) => ReturnType< typeof setTimeout >;
	clearTimeout?: ( handle: ReturnType< typeof setTimeout > ) => void;
	now?: () => number;
}

export interface ProgressStreamerOptions {
	config: RemoteSessionConfig;
	target: ProgressTarget;
	deps: ProgressStreamerDeps;
	/** Minimum ms between posted updates. Bursts within this window are coalesced. */
	intervalMs?: number;
	/** Max characters per posted progress message (after collapsing whitespace). */
	maxChars?: number;
}

/**
 * Status passed by the caller of `stop()`. Drives the final-edit summary.
 * Wider union than `TurnOutcomeStatus` so callers can opt out (`undefined`)
 * without us importing the turn-runner type and creating a circular import.
 */
export type ProgressFinalStatus =
	| 'success'
	| 'error'
	| 'timeout'
	| 'paused'
	| 'max_turns'
	| 'spawn_error';

// Telegram's edit-message bucket allows ~20 edits/minute/chat. 3 seconds is the
// safe floor; lower would risk 429s when an agent is fast-iterating tool calls.
const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_MAX_CHARS = 200;
const THINKING_PREVIEW_CHARS = 140;

interface PiContentBlockLike {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	name?: unknown;
}

interface PiAgentMessageLike {
	role?: unknown;
	content?: unknown;
}

/**
 * Italicize a text fragment using markdown the wpcom server understands.
 * `_..._` is converted to `<i>...</i>` by `markdown_to_telegram_html`, and the
 * server-side regex only treats `_` as an italic marker when not surrounded by
 * word characters — so internal `_` in site names like `my_site` are passed
 * through as literal characters rather than closing the italic span early.
 */
function italic( text: string ): string {
	const trimmed = text.trim();
	return trimmed.length === 0 ? '' : `_${ trimmed }_`;
}

/**
 * Pick the most informative content block from a finished assistant message.
 * Prefers `text > thinking > toolCall` — the model's own narration ("Stopping
 * all sites first!") is a better description of what's happening than any
 * label we could synthesize from the tool name. We fall through to the bare
 * tool name only when the LLM emitted no narration.
 *
 * Returns the chat-ready italicized fragment, or null when nothing displayable.
 */
function formatAssistantMessage( raw: AgentMessage ): string | null {
	const message = raw as PiAgentMessageLike;
	if ( ! message || typeof message !== 'object' || message.role !== 'assistant' ) {
		return null;
	}
	const blocks = message.content;
	if ( ! Array.isArray( blocks ) ) {
		return null;
	}
	let text: string | null = null;
	let thinking: string | null = null;
	let toolName: string | null = null;
	for ( const block of blocks as PiContentBlockLike[] ) {
		if ( ! block || typeof block !== 'object' ) {
			continue;
		}
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			const value = block.text.replace( /\s+/g, ' ' ).trim();
			if ( value.length > 0 ) {
				text = value;
			}
		} else if ( block.type === 'thinking' && typeof block.thinking === 'string' ) {
			const value = block.thinking.replace( /\s+/g, ' ' ).trim();
			if ( value.length > 0 ) {
				thinking = value;
			}
		} else if ( block.type === 'toolCall' && typeof block.name === 'string' ) {
			toolName = block.name;
		}
	}
	if ( text ) {
		return italic( text );
	}
	if ( thinking ) {
		const preview =
			thinking.length > THINKING_PREVIEW_CHARS
				? `${ thinking.slice( 0, THINKING_PREVIEW_CHARS - 1 ) }…`
				: thinking;
		return `💭 ${ italic( preview ) }`;
	}
	if ( toolName ) {
		return `🔧 ${ italic( toolName ) }`;
	}
	return null;
}

/**
 * Forwards rich step events from `studio code --json` to Telegram as a single
 * live status message that edits in place over the course of a turn.
 *
 * Lifecycle within a turn:
 *   1. First qualifying event → POST `action: 'create'`, capture the new
 *      `message_id` from the server.
 *   2. Subsequent events within `intervalMs` → coalesce to the latest and
 *      schedule a flush; events past the cadence floor → POST `action: 'edit'`
 *      against the stored `message_id`.
 *   3. If the server returns `retry_after_ms`, defer the next post by that
 *      amount (Telegram throttled the underlying editMessage call).
 *   4. `stop(status?)` finalizes the live status:
 *        - `'success'` → DELETE the status message, so the real reply (text or
 *          photo) is the only artifact left in chat.
 *        - any other terminal status → EDIT the status message to a one-line
 *          ⚠️ summary, so the failure stays visible.
 *        - `undefined` → no-op.
 *
 * Sources of displayed content:
 *   - `progress` / `info` envelopes — tool-internal progress strings, already
 *     i18n'd by the tools that emit them (e.g. "Stopping WordPress server…").
 *   - `message_end` envelopes — the LLM's own narration of what it's doing,
 *     emitted as `text` blocks alongside the `toolCall` blocks. Falls back to
 *     `thinking` blocks or the bare tool name when the model emits no text.
 *
 * Posts are serialized through a single promise chain (mirroring
 * MediaStreamer): a slow `create` blocks subsequent `edit`s until the
 * `messageId` is known, eliminating the "two status messages" race.
 */
export class ProgressStreamer {
	private readonly config: RemoteSessionConfig;
	private readonly target: ProgressTarget;
	private readonly deps: Required<
		Pick< ProgressStreamerDeps, 'setTimeout' | 'clearTimeout' | 'now' >
	> &
		ProgressStreamerDeps;
	private readonly intervalMs: number;
	private readonly maxChars: number;

	private timer: ReturnType< typeof setTimeout > | null = null;
	private pending: string | null = null;
	// Sentinel so the first event always passes the cooldown check, even if the
	// monotonic clock starts at 0 (real or test-injected).
	private lastPostAt = Number.NEGATIVE_INFINITY;
	/** Wall-clock floor returned by Telegram 429 throttling, in ms since epoch. */
	private rateLimitedUntilMs = 0;
	private disposed = false;

	/** Message id captured from the first successful create. */
	private messageId: number | null = null;
	/** Serializes posts so subsequent edits see the messageId from the create. */
	private queue: Promise< void > = Promise.resolve();
	/**
	 * If the most recent create errored, we have no messageId to edit, so the
	 * next post should try `create` again rather than stalling.
	 */
	private createFailed = false;
	/** Last text we posted; used to skip no-op edits that Telegram would reject. */
	private lastPostedText: string | null = null;

	constructor( options: ProgressStreamerOptions ) {
		this.config = options.config;
		this.target = options.target;
		this.deps = {
			...options.deps,
			setTimeout: options.deps.setTimeout ?? setTimeout,
			clearTimeout: options.deps.clearTimeout ?? clearTimeout,
			now: options.deps.now ?? ( () => Date.now() ),
		};
		this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
		this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	}

	readonly onEvent = ( event: JsonEvent ): void => {
		if ( this.disposed ) {
			return;
		}
		const rendered = renderEvent( event );
		if ( rendered === null ) {
			return;
		}
		const formatted = this.formatLine( rendered );
		// Telegram returns 400 "message is not modified" for edits that match the
		// current text. Skip silently so we don't burn an edit-bucket slot.
		if ( formatted === this.lastPostedText && this.pending === null ) {
			return;
		}
		const now = this.deps.now();
		const sinceLast = now - this.lastPostAt;
		const cooldownReady = sinceLast >= this.intervalMs;
		const rateLimitReady = now >= this.rateLimitedUntilMs;
		if ( cooldownReady && rateLimitReady ) {
			// First event, or both cooldown and any 429 window have elapsed —
			// post immediately.
			if ( this.timer !== null ) {
				this.deps.clearTimeout( this.timer );
				this.timer = null;
			}
			this.pending = null;
			this.post( formatted );
			return;
		}
		// Inside the cooldown / rate-limit window — keep only the latest
		// message and schedule a flush.
		this.pending = formatted;
		if ( this.timer === null ) {
			const cooldownWait = Math.max( 0, this.intervalMs - sinceLast );
			const rateLimitWait = Math.max( 0, this.rateLimitedUntilMs - now );
			const wait = Math.max( cooldownWait, rateLimitWait );
			this.timer = this.deps.setTimeout( () => this.flushPending(), wait );
		}
	};

	/**
	 * Stop the streamer and finalize the live status message.
	 *
	 * @param status The turn's terminal status:
	 *               - `'success'` → DELETE the status message, so the real
	 *                 reply (text/photo) is the only artifact left in chat.
	 *               - any other terminal status → EDIT to a ⚠️ summary so the
	 *                 failure stays visible.
	 *               - `undefined` → leave the last status text in place.
	 *
	 * Resolves once the delete/edit has settled so the caller can post the
	 * real reply in chat order.
	 */
	async stop( status?: ProgressFinalStatus ): Promise< void > {
		this.disposed = true;
		if ( this.timer !== null ) {
			this.deps.clearTimeout( this.timer );
			this.timer = null;
		}
		this.pending = null;

		// Wait for any in-flight post so we know the latest messageId and so
		// our final operation doesn't race a still-pending create.
		try {
			await this.queue;
		} catch {
			// Posts swallow their own errors; nothing to handle here.
		}

		if ( this.messageId === null || status === undefined ) {
			return;
		}

		if ( status === 'success' ) {
			try {
				await this.deps.respond(
					this.config,
					{
						chatId: this.target.chatId,
						bot: this.target.bot,
						action: 'delete',
						messageId: this.messageId,
					},
					{ logger: this.deps.logger, maxRetries: 0 }
				);
			} catch ( error ) {
				// Server-side delete is idempotent ("message to delete not found"
				// is treated as success) so any error here is a real transport /
				// auth problem worth a warning, not worth retrying.
				this.deps.logger.warn( 'Progress final delete failed', {
					chat_id: this.target.chatId,
					message_id: this.messageId,
					error: ( error as Error ).message,
				} );
			}
			return;
		}

		const summary = `⚠️ ${ italic( status ) }`;
		try {
			await this.deps.respond(
				this.config,
				{
					chatId: this.target.chatId,
					bot: this.target.bot,
					action: 'edit',
					messageId: this.messageId,
					text: summary,
				},
				{ logger: this.deps.logger, maxRetries: 0 }
			);
		} catch ( error ) {
			this.deps.logger.warn( 'Progress final edit failed', {
				chat_id: this.target.chatId,
				message_id: this.messageId,
				error: ( error as Error ).message,
			} );
		}
	}

	private flushPending(): void {
		this.timer = null;
		if ( this.disposed ) {
			return;
		}
		if ( this.pending === null ) {
			return;
		}
		const message = this.pending;
		this.pending = null;
		this.post( message );
	}

	private post( text: string ): void {
		this.lastPostAt = this.deps.now();
		this.lastPostedText = text;
		// Snapshot the action decision before queuing — by the time the queued
		// task runs, `this.messageId` may have been set by an earlier task and
		// we want this post to honor that.
		this.queue = this.queue.then( async () => {
			const action: 'create' | 'edit' =
				this.messageId !== null && ! this.createFailed ? 'edit' : 'create';
			const messageId = action === 'edit' ? ( this.messageId as number ) : undefined;

			// INFO-level so a remote-session.log tail can see the streamer's
			// intent without enabling debug.
			this.deps.logger.info( 'Progress streamer post', {
				chat_id: this.target.chatId,
				action,
				message_id: messageId,
				text_preview: text.slice( 0, 80 ),
			} );

			try {
				const outcome = await this.deps.respond(
					this.config,
					{
						chatId: this.target.chatId,
						bot: this.target.bot,
						action,
						messageId,
						text,
					},
					{ logger: this.deps.logger, maxRetries: 0 }
				);

				if ( outcome.retryAfterMs ) {
					// Slide the rate-limit floor out. Use the wall clock at the time
					// the response landed, not the queueing time, so chained edits
					// don't pile up retries while we're already waiting.
					this.rateLimitedUntilMs = Math.max(
						this.rateLimitedUntilMs,
						this.deps.now() + outcome.retryAfterMs
					);
				}

				if ( action === 'create' ) {
					if ( outcome.success && outcome.messageIds.length > 0 ) {
						this.messageId = outcome.messageIds[ 0 ];
						this.createFailed = false;
					} else {
						this.createFailed = true;
					}
				}
			} catch ( error ) {
				if ( action === 'create' ) {
					this.createFailed = true;
				}
				this.deps.logger.warn( 'Progress post failed', {
					chat_id: this.target.chatId,
					action,
					message_id: messageId,
					error: ( error as Error ).message,
				} );
			}
		} );
	}

	/**
	 * Normalize a pre-rendered status line: collapse whitespace and truncate to
	 * `maxChars`. The emoji prefix is already part of the rendered line so we
	 * count it against the limit (single-message progress, no chunking).
	 */
	private formatLine( raw: string ): string {
		const oneLine = raw.replace( /\s+/g, ' ' ).trim();
		return oneLine.length > this.maxChars ? `${ oneLine.slice( 0, this.maxChars - 1 ) }…` : oneLine;
	}
}

/**
 * Render a single NDJSON event into a chat-ready line. Returns null for events
 * the streamer doesn't surface (lifecycle, tool execution start/end,
 * empty messages). Tool execution events are intentionally dropped — the LLM's
 * narration in the surrounding `message_end` text blocks (and the tool's own
 * i18n'd `progress` events) describe what's happening better than any label
 * we could synthesize from the tool name.
 */
function renderEvent( event: JsonEvent ): string | null {
	switch ( event.type ) {
		case 'info':
		case 'progress': {
			const message = typeof event.message === 'string' ? event.message.trim() : '';
			return message.length > 0 ? `⏳ ${ italic( message ) }` : null;
		}
		case 'message':
			return renderSessionEvent( event.message );
		default:
			return null;
	}
}

function renderSessionEvent( event: AgentSessionEvent ): string | null {
	if ( event.type === 'message_end' ) {
		return formatAssistantMessage( event.message );
	}
	return null;
}
