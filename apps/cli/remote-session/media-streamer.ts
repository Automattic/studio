import type { JsonEvent } from '@studio/common/ai/json-events';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';
import type { respondMessage } from 'cli/remote-session/telegram-client';

interface ValidMediaShare {
	dataBase64: string;
	mimeType: 'image/png' | 'image/jpeg';
	caption?: string;
}

// `parseEvent` in turn-runner only checks for an object with a string `type`
// field, so a malformed `{"type":"media.share"}` line could reach here with
// missing/wrong-typed fields. Validate the shape at the boundary; log+skip
// invalid events instead of throwing into the readline `'line'` listener.
function parseMediaShare(
	event: Extract< JsonEvent, { type: 'media.share' } >
): ValidMediaShare | null {
	const dataBase64 = ( event as { dataBase64?: unknown } ).dataBase64;
	const mimeType = ( event as { mimeType?: unknown } ).mimeType;
	const caption = ( event as { caption?: unknown } ).caption;
	if ( typeof dataBase64 !== 'string' || dataBase64.length === 0 ) {
		return null;
	}
	if ( mimeType !== 'image/png' && mimeType !== 'image/jpeg' ) {
		return null;
	}
	if ( caption !== undefined && typeof caption !== 'string' ) {
		return null;
	}
	return { dataBase64, mimeType, caption };
}

export interface MediaTarget {
	chatId: number;
	bot?: string;
}

export interface MediaStreamerDeps {
	respond: typeof respondMessage;
	logger: RemoteSessionLogger;
}

export interface MediaStreamerOptions {
	config: RemoteSessionConfig;
	target: MediaTarget;
	deps: MediaStreamerDeps;
}

/**
 * Forwards `media.share` NDJSON events from `studio code --json` to Telegram as
 * photos in real time. Each photo POST kicks off as soon as the event arrives,
 * so the image appears in the chat while the model is still finishing its
 * follow-up text. POSTs are serialized through a single promise chain so that
 * multiple shares from one turn arrive in emit order. Failures are logged and
 * dropped — `respondMessage` already retries 5xx internally, so a final failure
 * here means the photo isn't recoverable for this turn.
 */
export class MediaStreamer {
	private readonly config: RemoteSessionConfig;
	private readonly target: MediaTarget;
	private readonly deps: MediaStreamerDeps;

	private queue: Promise< void > = Promise.resolve();
	private posted = 0;
	private failed = 0;

	constructor( options: MediaStreamerOptions ) {
		this.config = options.config;
		this.target = options.target;
		this.deps = options.deps;
	}

	readonly onEvent = ( event: JsonEvent ): void => {
		if ( event.type !== 'media.share' ) {
			return;
		}
		const valid = parseMediaShare( event );
		if ( ! valid ) {
			this.deps.logger.warn( 'Ignoring malformed media.share event', {
				chat_id: this.target.chatId,
			} );
			return;
		}
		const { dataBase64, mimeType, caption } = valid;
		this.deps.logger.debug( 'media.share received; queueing photo post', {
			chat_id: this.target.chatId,
			mime_type: mimeType,
			base64_chars: dataBase64.length,
			caption_length: caption?.length ?? 0,
		} );
		this.queue = this.queue.then( async () => {
			try {
				await this.deps.respond(
					this.config,
					{
						chatId: this.target.chatId,
						bot: this.target.bot,
						photo: dataBase64,
						photoMimeType: mimeType,
						caption,
					},
					{ logger: this.deps.logger }
				);
				this.posted++;
			} catch ( error ) {
				this.failed++;
				this.deps.logger.warn( 'Real-time media post failed; photo dropped', {
					chat_id: this.target.chatId,
					error: ( error as Error ).message,
				} );
			}
		} );
	};

	/** Wait for any in-flight photo POSTs to complete. Resolves once the queue drains. */
	async drain(): Promise< { posted: number; failed: number } > {
		await this.queue;
		return { posted: this.posted, failed: this.failed };
	}
}
