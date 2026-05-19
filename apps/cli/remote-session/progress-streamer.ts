import type { JsonEvent } from '@studio/common/ai/json-events';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';
import type { respondMessage } from 'cli/remote-session/respond-router';

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

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_MAX_CHARS = 200;

/**
 * Forwards `info` / `progress` NDJSON events from `studio code --json` to Telegram
 * as "⏳ …" updates. Coalesces bursts (at most one post per `intervalMs`), truncates
 * each message, and fires posts in the background so it never blocks the event reader.
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
	private disposed = false;

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
		if ( event.type !== 'info' && event.type !== 'progress' ) {
			return;
		}
		if ( typeof event.message !== 'string' || event.message.trim().length === 0 ) {
			return;
		}
		const formatted = this.format( event.message );
		const now = this.deps.now();
		const sinceLast = now - this.lastPostAt;
		if ( sinceLast >= this.intervalMs ) {
			// First event, or cooldown already elapsed — post immediately.
			if ( this.timer !== null ) {
				this.deps.clearTimeout( this.timer );
				this.timer = null;
			}
			this.pending = null;
			this.post( formatted );
			return;
		}
		// Inside the cooldown window — keep only the latest message and schedule a flush.
		this.pending = formatted;
		if ( this.timer === null ) {
			const wait = Math.max( 0, this.intervalMs - sinceLast );
			this.timer = this.deps.setTimeout( () => this.flushPending(), wait );
		}
	};

	stop(): void {
		this.disposed = true;
		if ( this.timer !== null ) {
			this.deps.clearTimeout( this.timer );
			this.timer = null;
		}
		this.pending = null;
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
		this.deps
			.respond(
				this.config,
				{ chatId: this.target.chatId, bot: this.target.bot, text },
				{ logger: this.deps.logger, maxRetries: 0 }
			)
			.catch( ( error: unknown ) => {
				this.deps.logger.warn( 'Progress post failed', {
					chat_id: this.target.chatId,
					error: ( error as Error ).message,
				} );
			} );
	}

	private format( raw: string ): string {
		const oneLine = raw.replace( /\s+/g, ' ' ).trim();
		const truncated =
			oneLine.length > this.maxChars ? `${ oneLine.slice( 0, this.maxChars - 1 ) }…` : oneLine;
		return `⏳ ${ truncated }`;
	}
}
