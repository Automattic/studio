import { __ } from '@wordpress/i18n';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
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
const STOP_WAIT_TIMEOUT_MS = 2_000;

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

// Used only when the LLM emits a toolCall block without any text/thinking
// preamble — the bare snake_case name (`share_screenshot`) is gerundized into
// a phrase ("Sharing screenshot…") so the chat reads naturally. Unknown verbs
// fall back to a literal space-separated form. Far smaller than per-tool
// descriptors (and unaffected by adding new tools) because it only handles the
// pattern, not specific phrasing per tool.
const VERB_TO_GERUND: Record< string, string > = {
	share: 'Sharing',
	take: 'Taking',
	scaffold: 'Scaffolding',
	validate: 'Validating',
	install: 'Installing',
	stop: 'Stopping',
	start: 'Starting',
	list: 'Listing',
	create: 'Creating',
	delete: 'Deleting',
	import: 'Importing',
	export: 'Exporting',
	pull: 'Pulling',
	push: 'Pushing',
	update: 'Updating',
	run: 'Running',
	info: 'Looking up details for',
	open: 'Opening',
	wait: 'Waiting for',
	ask: 'Asking',
};

/**
 * Map a turn's terminal status to a user-readable Telegram summary. The raw
 * union members (`max_turns`, `spawn_error`, …) are agent-internal identifiers
 * that would be meaningless if surfaced as italicized labels in chat, so we
 * project each one to a translated sentence. Italic wrapping is intentionally
 * dropped — these are short phrases, not labels, and read more naturally
 * unstyled.
 */
function formatFinalStatusSummary( status: ProgressFinalStatus ): string {
	switch ( status ) {
		case 'success':
			return `✅ ${ __( 'Done' ) }`;
		case 'error':
			return `⚠️ ${ __( 'Something went wrong' ) }`;
		case 'timeout':
			return `⚠️ ${ __( 'Took too long' ) }`;
		case 'paused':
			return `⚠️ ${ __( 'Paused' ) }`;
		case 'max_turns':
			return `⚠️ ${ __( 'Hit the turn limit' ) }`;
		case 'spawn_error':
			return `⚠️ ${ __( 'Could not start agent' ) }`;
	}
}

function humanizeToolName( name: string ): string {
	const parts = name.split( '_' ).filter( Boolean );
	if ( parts.length === 0 ) {
		return name;
	}
	// `verb_object` (e.g. `share_screenshot`) → "Sharing screenshot"
	if ( parts.length > 1 && VERB_TO_GERUND[ parts[ 0 ] ] ) {
		return `${ VERB_TO_GERUND[ parts[ 0 ] ] } ${ parts.slice( 1 ).join( ' ' ) }`;
	}
	// `object_verb` (e.g. `site_stop`) → "Stopping site"
	const last = parts.length - 1;
	if ( parts.length > 1 && VERB_TO_GERUND[ parts[ last ] ] ) {
		return `${ VERB_TO_GERUND[ parts[ last ] ] } ${ parts.slice( 0, last ).join( ' ' ) }`;
	}
	return parts.join( ' ' );
}

/**
 * Compose a final status line of the form `${prefix}_${text}_`, respecting an
 * absolute `maxChars` budget on the whole line. Whitespace is collapsed and
 * the line trimmed; an empty result returns `null` so the streamer skips the
 * post entirely.
 *
 * Two wpcom-side details shape this function:
 *   - `markdown_to_telegram_html` converts `_..._` to `<i>...</i>` only when
 *     the `_` is not surrounded by word characters, so internal underscores in
 *     site names like `my_site` survive as literal characters.
 *   - The same regex requires a closing `_` to italicize. Truncation therefore
 *     runs on the inner text *before* italic wrapping so the closing `_` is
 *     never sliced off; a broken span would leak literal underscores into the
 *     visible Telegram message.
 */
function buildItalicLine( text: string, prefix: string, maxChars: number ): string | null {
	const cleaned = text.replace( /\s+/g, ' ' ).trim();
	if ( cleaned.length === 0 ) {
		return null;
	}
	// Reserved chars in the final line: `prefix` + opening `_` + closing `_`.
	const innerBudget = Math.max( 1, maxChars - prefix.length - 2 );
	const inner =
		cleaned.length > innerBudget ? `${ cleaned.slice( 0, innerBudget - 1 ) }…` : cleaned;
	return `${ prefix }_${ inner }_`;
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
function formatAssistantMessage( raw: AgentMessage, maxChars: number ): string | null {
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
		return buildItalicLine( text, '', maxChars );
	}
	if ( thinking ) {
		// Pre-clamp to a tighter inline preview; `buildItalicLine` will still
		// enforce the absolute `maxChars` budget on top.
		const preview =
			thinking.length > THINKING_PREVIEW_CHARS
				? `${ thinking.slice( 0, THINKING_PREVIEW_CHARS - 1 ) }…`
				: thinking;
		return buildItalicLine( preview, '💭 ', maxChars );
	}
	if ( toolName ) {
		// Some turns emit `message_end` with only a `toolCall` block — no `text`
		// preamble. Mimic the `progress` envelope style (⏳ + italic + trailing
		// ellipsis) and gerundize the tool name so it reads as a phrase
		// ("Sharing screenshot…") rather than a snake_case identifier.
		return buildItalicLine( `${ humanizeToolName( toolName ) }…`, '⏳ ', maxChars );
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
 *   4. The turn ends via either:
 *        - `replaceWithReply(text)` (preferred success path) → EDIT the status
 *          message to become the actual reply text, so the turn occupies a
 *          single message in chat. Used when the reply fits the
 *          single-message limit and isn't a photo.
 *        - `stop(status?)` (fallback / non-success):
 *           - `'success'` → EDIT the status to `✅ _Done_` so the turn has a
 *             clear visual close when the caller couldn't fold the reply in
 *             via {@link replaceWithReply} (e.g. photo reply, oversized text).
 *             Note: edit-not-delete because some Telegram clients (Beeper)
 *             render deletions as a persistent tombstone.
 *           - any other terminal status → EDIT to a one-line ⚠️ summary so
 *             the failure stays visible.
 *           - `undefined` → no-op (leave the last status text in place).
 *
 * Sources of displayed content:
 *   - `progress` / `info` envelopes — tool-internal progress strings, already
 *     i18n'd by the tools that emit them (e.g. "Stopping WordPress server…").
 *   - `message_end` envelopes — the LLM's own narration of what it's doing,
 *     emitted as `text` blocks alongside the `toolCall` blocks. Falls back to
 *     `thinking` blocks or the bare tool name when the model emits no text.
 *
 * At most one status POST is in flight at a time. While that request is
 * running, new events collapse into one pending latest line, which is flushed
 * after the active request settles and the edit cadence allows another send.
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
	/** The one currently running status POST, if any. */
	private activePost: Promise< void > | null = null;
	/** Abort controller for the currently running status POST. */
	private activePostAbort: AbortController | null = null;
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
		const formatted = renderEvent( event, this.maxChars );
		if ( formatted === null ) {
			return;
		}
		// Telegram returns 400 "message is not modified" for edits that match the
		// current text. Skip silently so we don't burn an edit-bucket slot.
		if ( formatted === this.lastPostedText && this.pending === null ) {
			return;
		}
		if ( formatted === this.pending ) {
			return;
		}
		if ( this.activePost !== null ) {
			this.pending = formatted;
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
		this.schedulePendingFlush();
	};

	/**
	 * Replace the live status with the turn's final reply, in place. Returns
	 * `true` when the edit landed (caller should skip posting the reply as a
	 * new message), or `false` when there's no message to replace yet — in
	 * which case the caller falls through to `stop()` and posts the reply
	 * normally.
	 *
	 * Caller is responsible for ensuring `text` fits within the server's
	 * single-message limit; oversized replies should be chunked through the
	 * regular text path instead.
	 *
	 * Some Telegram clients (e.g. Beeper) render a deleted message as a
	 * persistent "🗑 This message has been deleted" tombstone, so editing the
	 * status into the actual reply produces a cleaner one-message-per-turn
	 * result than deleting + posting separately.
	 */
	async replaceWithReply( text: string ): Promise< boolean > {
		this.disposed = true;
		if ( this.timer !== null ) {
			this.deps.clearTimeout( this.timer );
			this.timer = null;
		}
		this.pending = null;

		if ( ! ( await this.waitForActivePost() ) || this.messageId === null ) {
			return false;
		}

		await this.respondWithTimeout( {
			chatId: this.target.chatId,
			bot: this.target.bot,
			action: 'edit',
			messageId: this.messageId,
			text,
		} );
		return true;
	}

	/**
	 * Stop the streamer and finalize the live status message.
	 *
	 * @param status The turn's terminal status:
	 *               - `'success'` → EDIT the status message to a one-line
	 *                 `✅ Done.` so the turn has a clear visual close even when
	 *                 the caller couldn't fold the reply in via
	 *                 {@link replaceWithReply}.
	 *               - any other terminal status → EDIT to a ⚠️ summary so the
	 *                 failure stays visible.
	 *               - `undefined` → leave the last status text in place.
	 *
	 * Resolves once the edit settles, or after a short timeout, so best-effort
	 * progress never blocks the real reply indefinitely.
	 */
	async stop( status?: ProgressFinalStatus ): Promise< void > {
		this.disposed = true;
		if ( this.timer !== null ) {
			this.deps.clearTimeout( this.timer );
			this.timer = null;
		}
		this.pending = null;

		if ( ! ( await this.waitForActivePost() ) && this.messageId === null ) {
			return;
		}

		if ( this.messageId === null || status === undefined ) {
			return;
		}

		const summary = formatFinalStatusSummary( status );
		await this.respondWithTimeout( {
			chatId: this.target.chatId,
			bot: this.target.bot,
			action: 'edit',
			messageId: this.messageId,
			text: summary,
		} );
	}

	private schedulePendingFlush(): void {
		if (
			this.disposed ||
			this.pending === null ||
			this.activePost !== null ||
			this.timer !== null
		) {
			return;
		}
		const now = this.deps.now();
		const cooldownWait = Math.max( 0, this.intervalMs - ( now - this.lastPostAt ) );
		const rateLimitWait = Math.max( 0, this.rateLimitedUntilMs - now );
		const wait = Math.max( cooldownWait, rateLimitWait );
		if ( wait === 0 ) {
			this.flushPending();
			return;
		}
		this.timer = this.deps.setTimeout( () => this.flushPending(), wait );
	}

	private flushPending(): void {
		this.timer = null;
		if ( this.disposed || this.pending === null || this.activePost !== null ) {
			return;
		}
		const message = this.pending;
		this.pending = null;
		this.post( message );
	}

	private post( text: string ): void {
		this.activePost = this.send( text ).finally( () => {
			this.activePost = null;
			this.activePostAbort = null;
			this.schedulePendingFlush();
		} );
	}

	private async send( text: string ): Promise< void > {
		const controller = new AbortController();
		this.activePostAbort = controller;
		this.lastPostAt = this.deps.now();
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
				{ logger: this.deps.logger, maxRetries: 0, signal: controller.signal }
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

			// Only poison the same-text dedupe cache once Telegram has actually
			// accepted this text. A failed post leaving the cache primed would
			// silently drop the next identical event (the dedupe guard in
			// `onEvent` would skip it as a no-op edit).
			if ( outcome.success ) {
				this.lastPostedText = text;
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
		} finally {
			if ( this.activePostAbort === controller ) {
				this.activePostAbort = null;
			}
		}
	}

	private async waitForActivePost(): Promise< boolean > {
		if ( this.activePost === null ) {
			return true;
		}
		let timeout: ReturnType< typeof setTimeout > | null = null;
		const timedOut = new Promise< false >( ( resolve ) => {
			timeout = this.deps.setTimeout( () => {
				// `fetch().abort()` cancels the local promise but cannot un-send
				// bytes already on the wire. If the aborted POST still lands at
				// Telegram after the final edit below, the user briefly sees the
				// older progress line again before the next interaction. The race
				// is narrow (the post had to hang past STOP_WAIT_TIMEOUT_MS yet
				// still succeed server-side, in the right order), but flag it so
				// a reported flicker is greppable.
				this.activePostAbort?.abort();
				this.deps.logger.warn(
					'Progress post timed out during stop; the final edit may race against a late delivery of the aborted post',
					{
						chat_id: this.target.chatId,
					}
				);
				resolve( false );
			}, STOP_WAIT_TIMEOUT_MS );
		} );
		const completed = this.activePost.then( () => true );
		const result = await Promise.race( [ completed, timedOut ] );
		if ( timeout !== null ) {
			this.deps.clearTimeout( timeout );
		}
		return result;
	}

	private async respondWithTimeout(
		params: Parameters< typeof respondMessage >[ 1 ]
	): Promise< void > {
		const controller = new AbortController();
		let timedOut = false;
		let timeout: ReturnType< typeof setTimeout > | null = null;
		const timeoutPromise = new Promise< null >( ( resolve ) => {
			timeout = this.deps.setTimeout( () => {
				timedOut = true;
				controller.abort();
				this.deps.logger.warn( 'Progress final response timed out', {
					chat_id: this.target.chatId,
					action: 'edit',
					message_id: params.messageId,
				} );
				resolve( null );
			}, STOP_WAIT_TIMEOUT_MS );
		} );
		const responsePromise = this.deps
			.respond( this.config, params, {
				logger: this.deps.logger,
				maxRetries: 0,
				signal: controller.signal,
			} )
			.catch( ( error ) => {
				this.deps.logger.warn( 'Progress final edit failed', {
					chat_id: this.target.chatId,
					message_id: params.messageId,
					error: ( error as Error ).message,
				} );
				return null;
			} );
		await Promise.race( [ responsePromise, timeoutPromise ] );
		if ( timeout !== null && ! timedOut ) {
			this.deps.clearTimeout( timeout );
		}
	}
}

/**
 * Render a single NDJSON event into a chat-ready line, already truncated to
 * `maxChars` and italicized so the output goes straight to Telegram. Returns
 * null for events the streamer doesn't surface (lifecycle, tool execution
 * start/end, empty messages). Tool execution events are intentionally dropped
 * — the LLM's narration in the surrounding `message_end` text blocks (and the
 * tool's own i18n'd `progress` events) describe what's happening better than
 * any label we could synthesize from the tool name.
 */
function renderEvent( event: JsonEvent, maxChars: number ): string | null {
	switch ( event.type ) {
		case 'info':
		case 'progress': {
			const message = typeof event.message === 'string' ? event.message : '';
			return buildItalicLine( message, '⏳ ', maxChars );
		}
		case 'message':
			return renderSessionEvent( event.message, maxChars );
		default:
			return null;
	}
}

function renderSessionEvent( event: AgentSessionEvent, maxChars: number ): string | null {
	if ( event.type === 'message_end' ) {
		return formatAssistantMessage( event.message, maxChars );
	}
	return null;
}
