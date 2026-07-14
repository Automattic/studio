import { type RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

export interface PolledMessage {
	chat_id: number;
	text: string;
	bot?: string;
}

export interface TelegramRequestContext {
	logger?: RemoteSessionLogger;
}

export class TelegramAuthError extends Error {
	constructor( public readonly status: number ) {
		super( `Telegram server returned auth error (HTTP ${ status })` );
		this.name = 'TelegramAuthError';
	}
}

export class TelegramTransientError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super( message );
		this.name = 'TelegramTransientError';
	}
}

export class TelegramBadRequestError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super( message );
		this.name = 'TelegramBadRequestError';
	}
}

function assertSameHost( urlString: string, allowedHost: string ): void {
	const u = new URL( urlString );
	if ( u.host !== allowedHost ) {
		throw new TelegramTransientError(
			`Refusing to follow redirect to different host: ${ u.host } (allowed: ${ allowedHost })`
		);
	}
}

function normalizeBase( base: string ): URL {
	// Ensure a trailing slash so relative path joins work predictably.
	return new URL( base.endsWith( '/' ) ? base : `${ base }/` );
}

function buildUrl( baseUrl: string, pathName: string ): string {
	const base = normalizeBase( baseUrl );
	const joined = new URL( pathName.replace( /^\//, '' ), base );
	return joined.toString();
}

/**
 * Poll the server for pending messages. Returns an empty array when nothing is queued.
 *
 * The server returns `{ messages: [ { message, chat_id, bot, user_id, timestamp }, ... ] }`.
 * A batch can contain any number of messages; the caller is expected to drain them in order
 * (one `studio code --json` turn per message) before polling again.
 *
 * Throws TelegramAuthError on 401/403, TelegramTransientError on 5xx or network errors.
 * No inbound retries are attempted — once polled, a dropped message is dropped.
 */
export async function pollMessages(
	config: RemoteSessionConfig,
	signal?: AbortSignal,
	context: TelegramRequestContext = {}
): Promise< PolledMessage[] > {
	const url = buildUrl( config.base_url, 'local-agent-poll' );
	const allowedHost = new URL( config.base_url ).host;
	assertSameHost( url, allowedHost );

	const controller = new AbortController();
	const timeoutId = setTimeout( () => controller.abort(), config.long_poll_timeout_seconds * 1000 );
	const composite = composeSignals( signal, controller.signal );
	const startedAt = Date.now();
	context.logger?.debug( 'Poll start', { url } );

	let response: Response;
	try {
		response = await fetch( url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${ config.token }`,
				Accept: 'application/json',
			},
			redirect: 'manual',
			signal: composite,
		} );
	} catch ( error ) {
		if ( error instanceof Error && error.name === 'AbortError' ) {
			// Treat both user-abort and timeout as "empty poll"; callers decide.
			if ( signal?.aborted ) {
				throw error;
			}
			context.logger?.debug( 'Poll timed out', {
				duration_ms: Date.now() - startedAt,
			} );
			return [];
		}
		const message = ( error as Error ).message ?? 'unknown';
		context.logger?.warn( 'Poll network error', { error: message } );
		throw new TelegramTransientError( `Network error polling Telegram: ${ message }` );
	} finally {
		clearTimeout( timeoutId );
	}

	if ( response.status === 401 || response.status === 403 ) {
		context.logger?.error( 'Poll auth error', { status: response.status } );
		throw new TelegramAuthError( response.status );
	}
	if ( response.status >= 500 ) {
		context.logger?.warn( 'Poll 5xx', { status: response.status } );
		throw new TelegramTransientError( `Poll returned ${ response.status }`, response.status );
	}
	if ( response.status === 204 ) {
		context.logger?.debug( 'Poll 204 (no messages)', {
			duration_ms: Date.now() - startedAt,
		} );
		return [];
	}
	if ( response.status >= 300 && response.status < 400 ) {
		context.logger?.warn( 'Poll redirect', { status: response.status } );
		// Never follow server-issued redirects blindly.
		throw new TelegramTransientError(
			`Unexpected redirect from poll endpoint: HTTP ${ response.status }`,
			response.status
		);
	}
	if ( ! response.ok ) {
		context.logger?.warn( 'Poll unexpected status', { status: response.status } );
		throw new TelegramTransientError(
			`Poll returned unexpected status ${ response.status }`,
			response.status
		);
	}

	const text = await response.text();
	if ( ! text.trim() ) {
		context.logger?.debug( 'Poll empty body', {
			duration_ms: Date.now() - startedAt,
		} );
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse( text );
	} catch {
		context.logger?.warn( 'Poll body not JSON', {
			body_preview: text.slice( 0, 200 ),
		} );
		return [];
	}
	const messages = extractMessages( parsed );
	context.logger?.debug( 'Poll finished', {
		status: response.status,
		duration_ms: Date.now() - startedAt,
		messages: messages.length,
	} );
	return messages;
}

function extractMessages( payload: unknown ): PolledMessage[] {
	if ( ! payload || typeof payload !== 'object' ) {
		return [];
	}
	const record = payload as Record< string, unknown >;
	// Real server shape: { messages: [ { message, chat_id, bot, user_id, timestamp }, ... ] }.
	// Accept some alternates defensively in case the server adds a single-message form later.
	const candidates: unknown[] = Array.isArray( record.messages )
		? record.messages
		: record.message && typeof record.message === 'object'
		? [ record.message ]
		: typeof record.chat_id === 'number'
		? [ record ]
		: [];

	const out: PolledMessage[] = [];
	for ( const entry of candidates ) {
		if ( ! entry || typeof entry !== 'object' ) {
			continue;
		}
		const e = entry as Record< string, unknown >;
		const chatId = e.chat_id;
		// `message` is the real field name; `text` is accepted as a fallback.
		const text =
			typeof e.message === 'string' ? e.message : typeof e.text === 'string' ? e.text : undefined;
		if ( typeof chatId !== 'number' || typeof text !== 'string' ) {
			continue;
		}
		const bot = typeof e.bot === 'string' ? e.bot : undefined;
		out.push( { chat_id: chatId, text, bot } );
	}
	return out;
}

export type RespondAction = 'create' | 'edit';

export interface RespondParams {
	chatId: number;
	bot?: string;
	/**
	 * What to do on Telegram's side. Defaults to `create` (sendMessage / sendPhoto).
	 *  - `edit` requires `text` + `messageId`, forbids `photo` / `caption` in v1.
	 *
	 * The wpcom endpoint also accepts `delete` and `chat_action`, but neither
	 * has a production caller in this codebase: the progress streamer settled
	 * on edit-not-delete after Beeper rendered deletions as a persistent
	 * tombstone. Add them back to the client when a consumer needs them.
	 */
	action?: RespondAction;
	/** Required for `edit`. Returned by an earlier successful create. */
	messageId?: number;
	/** Plain text reply. Required for `create` (when no `photo`) and for `edit`. */
	text?: string;
	/**
	 * Base64-encoded image bytes (PNG or JPEG). `create` only. When set, the
	 * request goes out as `multipart/form-data` so the server forwards it to
	 * Telegram via `sendPhoto`.
	 */
	photo?: string;
	/** MIME type of the photo bytes. Defaults to `image/png`. */
	photoMimeType?: 'image/png' | 'image/jpeg';
	/** Caption to send alongside `photo`. The server demotes long captions to a follow-up message. */
	caption?: string;
}

/**
 * Structured outcome of a `respondMessage` call. Always returned on 2xx, even
 * when `success === false` — callers inspect `retryAfterMs` / `error` to
 * decide what to do next, rather than catching exceptions.
 */
export interface RespondOutcome {
	success: boolean;
	/**
	 * Telegram message ids returned by the server. For `create`, one per chunk
	 * (text + optional photo). For `edit`, contains the edited message id.
	 * Empty for any failure mode that didn't land a message.
	 */
	messageIds: number[];
	/** Populated when Telegram throttled the underlying API call. */
	retryAfterMs?: number;
	textSent?: boolean;
	photoSent?: boolean;
	chunksSent?: number;
	error?: string;
}

interface RespondResponseBody {
	success?: boolean;
	photo_sent?: boolean;
	text_sent?: boolean;
	chunks_sent?: number;
	message_ids?: number[];
	retry_after_ms?: number;
	error?: string;
}

/**
 * POST a message back to Telegram. Retries up to 3 times on 5xx with exponential backoff.
 * 4xx responses are surfaced as TelegramBadRequestError and should be logged but not retried.
 *
 * Dispatches on `params.action` (default `create`). All actions share the same
 * auth, retry, and outcome envelope:
 *   - `create` (text only)      — `application/json` body to /local-agent-respond.
 *   - `create` (text + photo)   — `multipart/form-data` with the raw photo bytes.
 *   - `edit`                    — `application/json` body, single message, no chunking.
 *
 * The server always answers with HTTP 200 and a JSON body indicating partial outcomes
 * (`success`, `photo_sent`, `text_sent`, `message_ids`, `retry_after_ms`, `error`).
 * We log a warning when `success` is false but do NOT throw on `retry_after_ms` —
 * the caller inspects the returned outcome and decides how long to back off.
 */
export async function respondMessage(
	config: RemoteSessionConfig,
	params: RespondParams,
	options: { signal?: AbortSignal; maxRetries?: number; logger?: RemoteSessionLogger } = {}
): Promise< RespondOutcome > {
	const action: RespondAction = params.action ?? 'create';

	// Normalize empty strings to "absent" so every downstream check (early
	// guard, body builder, debug log) agrees on what counts as present.
	const text = params.text && params.text.length > 0 ? params.text : undefined;
	const photo = params.photo && params.photo.length > 0 ? params.photo : undefined;
	const caption = params.caption && params.caption.length > 0 ? params.caption : undefined;
	const messageId = params.messageId;

	validateRespondParams( action, { text, photo, caption, messageId } );

	const url = buildUrl( config.base_url, 'local-agent-respond' );
	const allowedHost = new URL( config.base_url ).host;
	assertSameHost( url, allowedHost );

	const bot = params.bot ?? config.bot;
	const { body, contentType } = buildRespondBody( {
		chatId: params.chatId,
		bot,
		action,
		messageId,
		text,
		photo,
		photoMimeType: params.photoMimeType,
		caption,
	} );

	const maxRetries = options.maxRetries ?? 3;
	let attempt = 0;
	let lastError: unknown;
	const logger = options.logger;
	logger?.debug( 'Respond start', {
		chat_id: params.chatId,
		bot,
		action,
		message_id: messageId,
		text_length: text?.length ?? 0,
		text_preview: text?.slice( 0, 120 ),
		has_photo: photo !== undefined,
		photo_base64_chars: photo?.length ?? 0,
		photo_mime_type: params.photoMimeType,
		caption_length: caption?.length ?? 0,
		transport: contentType === undefined ? 'multipart' : 'json',
	} );

	while ( attempt <= maxRetries ) {
		let response: Response;
		try {
			// Note: when `body` is a FormData the runtime sets the multipart
			// Content-Type with the proper boundary. Setting it manually here
			// would corrupt the boundary token, so we omit it for that path.
			const headers: Record< string, string > = {
				Authorization: `Bearer ${ config.token }`,
			};
			if ( contentType ) {
				headers[ 'Content-Type' ] = contentType;
			}
			response = await fetch( url, {
				method: 'POST',
				headers,
				body,
				redirect: 'manual',
				signal: options.signal,
			} );
		} catch ( error ) {
			lastError = error;
			if ( error instanceof Error && error.name === 'AbortError' ) {
				throw error;
			}
			logger?.warn( 'Respond network error', {
				attempt,
				chat_id: params.chatId,
				error: ( error as Error ).message,
			} );
			await backoff( attempt );
			attempt++;
			continue;
		}

		if ( response.status === 401 || response.status === 403 ) {
			logger?.error( 'Respond auth error', {
				status: response.status,
				chat_id: params.chatId,
			} );
			throw new TelegramAuthError( response.status );
		}
		if ( response.status >= 500 ) {
			logger?.warn( 'Respond 5xx', { status: response.status, attempt } );
			lastError = new TelegramTransientError(
				`Respond returned ${ response.status }`,
				response.status
			);
			await backoff( attempt );
			attempt++;
			continue;
		}
		if ( response.status >= 400 ) {
			const text = await safeReadText( response );
			logger?.warn( 'Respond 4xx', {
				status: response.status,
				chat_id: params.chatId,
				body_preview: text.slice( 0, 200 ),
			} );
			throw new TelegramBadRequestError(
				`Respond returned ${ response.status }${ text ? `: ${ text }` : '' }`,
				response.status
			);
		}
		if ( ! response.ok ) {
			logger?.warn( 'Respond unexpected status', { status: response.status } );
			throw new TelegramTransientError(
				`Respond returned unexpected status ${ response.status }`,
				response.status
			);
		}

		const raw = await readRespondOutcome( response );
		const outcome = toRespondOutcome( raw );
		if ( ! outcome.success ) {
			logger?.warn( 'Respond reported partial failure', {
				chat_id: params.chatId,
				action,
				photo_sent: outcome.photoSent,
				text_sent: outcome.textSent,
				retry_after_ms: outcome.retryAfterMs,
				error: outcome.error,
			} );
		} else {
			logger?.debug( 'Respond ok', {
				status: response.status,
				chat_id: params.chatId,
				action,
				attempt,
				photo_sent: outcome.photoSent,
				text_sent: outcome.textSent,
				chunks_sent: outcome.chunksSent,
				message_ids: outcome.messageIds,
				retry_after_ms: outcome.retryAfterMs,
			} );
		}
		return outcome;
	}

	logger?.error( 'Respond failed after retries', {
		chat_id: params.chatId,
		action,
		max_retries: maxRetries,
	} );
	if ( lastError instanceof Error ) {
		throw lastError;
	}
	throw new TelegramTransientError( 'Respond failed after retries' );
}

function validateRespondParams(
	action: RespondAction,
	parts: {
		text: string | undefined;
		photo: string | undefined;
		caption: string | undefined;
		messageId: number | undefined;
	}
): void {
	const { text, photo, caption, messageId } = parts;
	switch ( action ) {
		case 'create':
			if ( ! text && ! photo ) {
				throw new Error( 'respondMessage create requires `text`, `photo`, or both' );
			}
			if ( messageId !== undefined ) {
				throw new Error( 'respondMessage create does not accept `messageId`' );
			}
			return;
		case 'edit':
			if ( messageId === undefined ) {
				throw new Error( 'respondMessage edit requires `messageId`' );
			}
			if ( ! text ) {
				throw new Error( 'respondMessage edit requires `text`' );
			}
			if ( photo || caption ) {
				throw new Error( 'respondMessage edit does not accept `photo` or `caption` (v1)' );
			}
			return;
	}
}

function toRespondOutcome( raw: RespondResponseBody | null ): RespondOutcome {
	// A missing body is treated as a bare success — preserves the historical
	// behavior where the server occasionally returned 200 with an empty body.
	if ( ! raw ) {
		return { success: true, messageIds: [] };
	}
	const out: RespondOutcome = {
		success: raw.success !== false,
		messageIds: Array.isArray( raw.message_ids )
			? raw.message_ids.filter( ( id ): id is number => typeof id === 'number' )
			: [],
	};
	if ( typeof raw.retry_after_ms === 'number' && raw.retry_after_ms > 0 ) {
		out.retryAfterMs = raw.retry_after_ms;
	}
	if ( typeof raw.text_sent === 'boolean' ) {
		out.textSent = raw.text_sent;
	}
	if ( typeof raw.photo_sent === 'boolean' ) {
		out.photoSent = raw.photo_sent;
	}
	if ( typeof raw.chunks_sent === 'number' ) {
		out.chunksSent = raw.chunks_sent;
	}
	if ( typeof raw.error === 'string' ) {
		out.error = raw.error;
	}
	return out;
}

interface BuildBodyParams {
	chatId: number;
	bot?: string;
	action: RespondAction;
	messageId?: number;
	text?: string;
	photo?: string;
	photoMimeType?: 'image/png' | 'image/jpeg';
	caption?: string;
}

// Telegram caps captions at 1024 characters and the wpcom endpoint rejects
// anything longer with HTTP 400. Truncate at the client so a slightly
// over-cap caption from the agent doesn't drop the whole photo.
const CAPTION_MAX_CHARS = 1024;

function clampCaption( caption: string | undefined ): string | undefined {
	if ( ! caption ) {
		return undefined;
	}
	if ( caption.length <= CAPTION_MAX_CHARS ) {
		return caption;
	}
	return `${ caption.slice( 0, CAPTION_MAX_CHARS - 1 ) }…`;
}

function buildRespondBody( params: BuildBodyParams ): {
	body: string | FormData;
	/** Set for the JSON path; `undefined` for multipart so fetch fills the boundary in. */
	contentType?: string;
} {
	// Photos only ride the multipart path, and the server rejects `photo` on any
	// non-create action — so multipart is implicitly create-only.
	if ( params.photo ) {
		const fd = new FormData();
		fd.append( 'chat_id', String( params.chatId ) );
		if ( params.bot ) {
			fd.append( 'bot', params.bot );
		}
		// Default action is `create`; only emit the field when it's non-default
		// so existing servers that don't yet know `action` still accept the body.
		if ( params.action !== 'create' ) {
			fd.append( 'action', params.action );
		}
		if ( params.text ) {
			fd.append( 'text', params.text );
		}
		const caption = clampCaption( params.caption );
		if ( caption ) {
			fd.append( 'caption', caption );
		}
		const mime = params.photoMimeType ?? 'image/png';
		const filename = mime === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png';
		const bytes = Buffer.from( params.photo, 'base64' );
		fd.append( 'photo', new Blob( [ new Uint8Array( bytes ) ], { type: mime } ), filename );
		return { body: fd };
	}

	const json: Record< string, unknown > = { chat_id: params.chatId };
	if ( params.bot ) {
		json.bot = params.bot;
	}
	if ( params.action !== 'create' ) {
		json.action = params.action;
	}
	if ( params.messageId !== undefined ) {
		json.message_id = params.messageId;
	}
	if ( params.text ) {
		json.text = params.text;
	}
	return { body: JSON.stringify( json ), contentType: 'application/json' };
}

async function readRespondOutcome( response: Response ): Promise< RespondResponseBody | null > {
	const raw = await safeReadText( response );
	if ( ! raw.trim() ) {
		return null;
	}
	try {
		return JSON.parse( raw ) as RespondResponseBody;
	} catch {
		return null;
	}
}

async function safeReadText( response: Response ): Promise< string > {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

async function backoff( attempt: number ): Promise< void > {
	const baseMs = Math.min( 30_000, 500 * Math.pow( 2, attempt ) );
	const jitter = Math.random() * 200;
	await new Promise( ( resolve ) => setTimeout( resolve, baseMs + jitter ) );
}

function composeSignals( a?: AbortSignal, b?: AbortSignal ): AbortSignal | undefined {
	if ( ! a ) {
		return b;
	}
	if ( ! b ) {
		return a;
	}
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if ( a.aborted || b.aborted ) {
		controller.abort();
	} else {
		a.addEventListener( 'abort', onAbort, { once: true } );
		b.addEventListener( 'abort', onAbort, { once: true } );
	}
	return controller.signal;
}
