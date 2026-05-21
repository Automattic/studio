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
// How long to keep a thinking preview at a glance — long thoughts get
// truncated with an ellipsis so the line stays readable.
const THINKING_PREVIEW_CHARS = 140;
// Bound the args cache so an unbounded agent loop can't grow it forever.
// 256 in-flight tool calls per turn is far above anything realistic.
const TOOL_ARGS_CACHE_LIMIT = 256;

interface PiContentBlockLike {
	type?: unknown;
	text?: unknown;
	thinking?: unknown;
	name?: unknown;
	arguments?: unknown;
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
	if ( trimmed.length === 0 ) {
		return '';
	}
	return `_${ trimmed }_`;
}

/**
 * Best-effort string extraction from arbitrary tool args. Returns an empty
 * string when the named field isn't a non-empty string — callers decide
 * whether to fall back to a generic label.
 */
function stringArg( args: unknown, key: string ): string {
	if ( ! args || typeof args !== 'object' ) {
		return '';
	}
	const value = ( args as Record< string, unknown > )[ key ];
	return typeof value === 'string' && value.length > 0 ? value : '';
}

function siteSubject( args: unknown ): string {
	return stringArg( args, 'nameOrPath' ) || 'site';
}

/**
 * Human-readable labels for a tool call's start and end. `errorEnd` covers the
 * tool_execution_end branch where `isError === true`. Each tool we know
 * customizes its phrasing; unknown tools fall through to `describeUnknown`,
 * which mechanically humanizes the tool name.
 */
interface ToolDescription {
	start: string;
	end: string;
	errorEnd: string;
}

type ToolDescriber = ( args: unknown ) => ToolDescription;

const TOOL_DESCRIBERS: Record< string, ToolDescriber > = {
	site_list: () => ( {
		start: 'Listing sites',
		end: 'Listed sites',
		errorEnd: 'Failed to list sites',
	} ),
	site_start: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Starting ${ subject }`,
			end: `Started ${ subject }`,
			errorEnd: `Failed to start ${ subject }`,
		};
	},
	site_stop: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Stopping ${ subject }`,
			end: `Stopped ${ subject }`,
			errorEnd: `Failed to stop ${ subject }`,
		};
	},
	site_info: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Looking up details for ${ subject }`,
			end: `Got details for ${ subject }`,
			errorEnd: `Couldn't get details for ${ subject }`,
		};
	},
	site_create: ( args ) => {
		const subject = stringArg( args, 'name' ) || 'a new site';
		return {
			start: `Creating ${ subject }`,
			end: `Created ${ subject }`,
			errorEnd: `Failed to create ${ subject }`,
		};
	},
	site_delete: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Deleting ${ subject }`,
			end: `Deleted ${ subject }`,
			errorEnd: `Failed to delete ${ subject }`,
		};
	},
	site_export: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Exporting ${ subject }`,
			end: `Exported ${ subject }`,
			errorEnd: `Failed to export ${ subject }`,
		};
	},
	site_import: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Importing into ${ subject }`,
			end: `Imported into ${ subject }`,
			errorEnd: `Failed to import into ${ subject }`,
		};
	},
	site_pull: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Pulling ${ subject } from WordPress.com`,
			end: `Pulled ${ subject }`,
			errorEnd: `Failed to pull ${ subject }`,
		};
	},
	site_push: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Pushing ${ subject } to WordPress.com`,
			end: `Pushed ${ subject }`,
			errorEnd: `Failed to push ${ subject }`,
		};
	},
	site_connected_remote_sites: () => ( {
		start: 'Listing connected WordPress.com sites',
		end: 'Listed connected sites',
		errorEnd: 'Failed to list connected sites',
	} ),
	preview_list: () => ( {
		start: 'Listing previews',
		end: 'Listed previews',
		errorEnd: 'Failed to list previews',
	} ),
	preview_create: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Creating a preview for ${ subject }`,
			end: `Preview created for ${ subject }`,
			errorEnd: `Failed to create preview for ${ subject }`,
		};
	},
	preview_update: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Updating preview for ${ subject }`,
			end: `Updated preview for ${ subject }`,
			errorEnd: `Failed to update preview for ${ subject }`,
		};
	},
	preview_delete: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Deleting preview for ${ subject }`,
			end: `Deleted preview for ${ subject }`,
			errorEnd: `Failed to delete preview for ${ subject }`,
		};
	},
	wp_cli: ( args ) => {
		const command = stringArg( args, 'command' );
		const fragment = command ? `wp ${ command }` : 'wp-cli';
		return {
			start: `Running ${ fragment }`,
			end: `Ran ${ fragment }`,
			errorEnd: `${ fragment } failed`,
		};
	},
	wpcom_request: ( args ) => {
		const path = stringArg( args, 'path' );
		const fragment = path ? `WordPress.com ${ path }` : 'WordPress.com API';
		return {
			start: `Calling ${ fragment }`,
			end: `Called ${ fragment }`,
			errorEnd: `${ fragment } call failed`,
		};
	},
	take_screenshot: ( args ) => {
		const url = stringArg( args, 'url' );
		return {
			start: url ? `Taking a screenshot of ${ url }` : 'Taking a screenshot',
			end: 'Screenshot ready',
			errorEnd: 'Screenshot failed',
		};
	},
	share_screenshot: ( args ) => {
		const url = stringArg( args, 'url' );
		return {
			start: url ? `Sharing a screenshot of ${ url }` : 'Sharing a screenshot',
			end: 'Screenshot shared',
			errorEnd: 'Failed to share screenshot',
		};
	},
	validate_blocks: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Validating blocks in ${ subject }`,
			end: `Validated blocks in ${ subject }`,
			errorEnd: `Block validation failed for ${ subject }`,
		};
	},
	scaffold_theme: ( args ) => {
		const themeName = stringArg( args, 'name' );
		return {
			start: themeName ? `Scaffolding theme "${ themeName }"` : 'Scaffolding a theme',
			end: themeName ? `Scaffolded theme "${ themeName }"` : 'Theme scaffolded',
			errorEnd: 'Theme scaffolding failed',
		};
	},
	install_taxonomy_scripts: () => ( {
		start: 'Installing taxonomy scripts',
		end: 'Installed taxonomy scripts',
		errorEnd: 'Failed to install taxonomy scripts',
	} ),
	need_for_speed: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Auditing performance for ${ subject }`,
			end: `Performance audit ready for ${ subject }`,
			errorEnd: `Performance audit failed for ${ subject }`,
		};
	},
	rank_me_up: ( args ) => {
		const subject = siteSubject( args );
		return {
			start: `Running SEO audit for ${ subject }`,
			end: `SEO audit ready for ${ subject }`,
			errorEnd: `SEO audit failed for ${ subject }`,
		};
	},
	studio_present: () => ( {
		start: 'Preparing a presentation',
		end: 'Presentation ready',
		errorEnd: 'Presentation failed',
	} ),
	open_annotation_browser: () => ( {
		start: 'Opening the annotation browser',
		end: 'Annotation browser open',
		errorEnd: 'Could not open annotation browser',
	} ),
	wait_for_annotations: () => ( {
		start: 'Waiting for annotations',
		end: 'Got annotations',
		errorEnd: 'Annotation wait failed',
	} ),
	ask_user_question: () => ( {
		start: 'Asking you a question',
		end: 'Got your answer',
		errorEnd: 'Question failed',
	} ),
};

function describeUnknown( toolName: string ): ToolDescription {
	const humanized = toolName.replace( /_/g, ' ' );
	return {
		start: `Running ${ humanized }`,
		end: `Ran ${ humanized }`,
		errorEnd: `${ humanized } failed`,
	};
}

function describeTool( toolName: string, args: unknown ): ToolDescription {
	const describer = TOOL_DESCRIBERS[ toolName ];
	return describer ? describer( args ) : describeUnknown( toolName );
}

/**
 * Pick the most "active-looking" content block from a finished assistant
 * message. Walks blocks in reverse so the latest action wins, and prefers
 * toolCall (the action) > thinking (the reasoning) > text (the narration).
 *
 * Returns the chat-ready italicized fragment, or null when the message has
 * nothing displayable.
 */
function formatAssistantMessage(
	raw: AgentMessage,
	rememberArgs: ( toolCallId: string | undefined, args: unknown ) => void
): string | null {
	const message = raw as PiAgentMessageLike;
	if ( ! message || typeof message !== 'object' || message.role !== 'assistant' ) {
		return null;
	}
	const blocks = message.content;
	if ( ! Array.isArray( blocks ) ) {
		return null;
	}
	for ( let i = blocks.length - 1; i >= 0; i-- ) {
		const block = blocks[ i ] as PiContentBlockLike;
		if ( ! block || typeof block !== 'object' ) {
			continue;
		}
		if ( block.type === 'toolCall' ) {
			const name = typeof block.name === 'string' ? block.name : '<unknown>';
			const args = block.arguments;
			// Remember args from message_end-style tool calls too — some runtimes
			// surface tool calls only through message_end, not via a separate
			// tool_execution_start event, and tool_execution_end still arrives later.
			const id = ( block as { id?: unknown } ).id;
			rememberArgs( typeof id === 'string' ? id : undefined, args );
			return `🔧 ${ italic( describeTool( name, args ).start ) }`;
		}
		if ( block.type === 'thinking' && typeof block.thinking === 'string' ) {
			const thought = block.thinking.replace( /\s+/g, ' ' ).trim();
			if ( thought.length > 0 ) {
				const preview =
					thought.length > THINKING_PREVIEW_CHARS
						? `${ thought.slice( 0, THINKING_PREVIEW_CHARS - 1 ) }…`
						: thought;
				return `💭 ${ italic( preview ) }`;
			}
		}
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			const text = block.text.replace( /\s+/g, ' ' ).trim();
			if ( text.length > 0 ) {
				return italic( text );
			}
		}
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
 *          photo) is the only artifact left in chat. A `✅ Done` line would
 *          just be noise once the actual result lands.
 *        - any other terminal status → EDIT the status message to a one-line
 *          ⚠️ summary, so the user can still see that something went wrong.
 *        - `undefined` → no-op (caller doesn't know the outcome).
 *      Either way, `stop()` resolves once the final edit/delete has settled so
 *      the caller can post the real reply in chat order. If no message was
 *      ever created, `stop()` is a no-op.
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
	/**
	 * Per-(toolCallId) args remembered from `tool_execution_start` (and from
	 * toolCall blocks inside `message_end`). Looked up at `tool_execution_end`
	 * so we can phrase the completion line in terms of the original target —
	 * `Stopped Catnap` instead of just `Stopped`.
	 */
	private readonly toolArgs = new Map< string, unknown >();

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
		const rendered = this.renderEvent( event );
		if ( rendered === null ) {
			return;
		}
		const formatted = this.formatLine( rendered );
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

	/**
	 * Render a single NDJSON event into a chat-ready line. Returns null for
	 * events the streamer doesn't surface (lifecycle, tool_execution_update,
	 * empty messages). Side-effect: stashes tool-call args by id so the
	 * matching `tool_execution_end` can phrase its completion line correctly.
	 */
	private renderEvent( event: JsonEvent ): string | null {
		switch ( event.type ) {
			case 'info':
			case 'progress': {
				const message = typeof event.message === 'string' ? event.message.trim() : '';
				return message.length > 0 ? `⏳ ${ italic( message ) }` : null;
			}
			case 'message':
				return this.renderSessionEvent( event.message );
			default:
				return null;
		}
	}

	private renderSessionEvent( event: AgentSessionEvent ): string | null {
		if ( event.type === 'tool_execution_start' ) {
			const toolName = typeof event.toolName === 'string' ? event.toolName : '<unknown>';
			this.rememberToolArgs( event.toolCallId, event.args );
			return `🔧 ${ italic( describeTool( toolName, event.args ).start ) }`;
		}
		if ( event.type === 'tool_execution_end' ) {
			const toolName = typeof event.toolName === 'string' ? event.toolName : '<unknown>';
			const args = this.consumeToolArgs( event.toolCallId );
			const description = describeTool( toolName, args );
			const phrase = event.isError === true ? description.errorEnd : description.end;
			const emoji = event.isError === true ? '⚠️' : '✅';
			return `${ emoji } ${ italic( phrase ) }`;
		}
		if ( event.type === 'message_end' ) {
			return formatAssistantMessage( event.message, ( id, args ) =>
				this.rememberToolArgs( id, args )
			);
		}
		// message_start / message_update / tool_execution_update are deliberately
		// dropped — they fire too often and the *_end events carry the same info.
		return null;
	}

	private rememberToolArgs( toolCallId: unknown, args: unknown ): void {
		if ( typeof toolCallId !== 'string' || toolCallId.length === 0 ) {
			return;
		}
		// Eviction is naive — drop the oldest insertion when we'd cross the
		// bound. Map iteration order is insertion order so .keys().next() is
		// the oldest entry.
		if ( this.toolArgs.size >= TOOL_ARGS_CACHE_LIMIT && ! this.toolArgs.has( toolCallId ) ) {
			const oldest = this.toolArgs.keys().next().value;
			if ( oldest !== undefined ) {
				this.toolArgs.delete( oldest );
			}
		}
		this.toolArgs.set( toolCallId, args );
	}

	private consumeToolArgs( toolCallId: unknown ): unknown {
		if ( typeof toolCallId !== 'string' || toolCallId.length === 0 ) {
			return undefined;
		}
		const args = this.toolArgs.get( toolCallId );
		this.toolArgs.delete( toolCallId );
		return args;
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
		// Snapshot the action decision before queuing — by the time the queued
		// task runs, `this.messageId` may have been set by an earlier task and
		// we want this post to honor that.
		this.queue = this.queue.then( async () => {
			const action: 'create' | 'edit' =
				this.messageId !== null && ! this.createFailed ? 'edit' : 'create';
			const messageId = action === 'edit' ? ( this.messageId as number ) : undefined;

			// INFO-level so a remote-session.log tail can see the streamer's
			// intent without enabling debug. Helpful for diagnosing whether the
			// new edit-in-place path is exercised vs the legacy "post new
			// message every time" behavior.
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
