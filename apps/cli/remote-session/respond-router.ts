import {
	RemoteAuthError,
	RemoteBadRequestError,
	RemoteTransientError,
	assertSameHost,
	backoff,
	buildUrl,
	safeReadText,
} from 'cli/remote-session/remote-http';
import {
	buildMobileRespondBody,
	buildMobileRespondUrl,
	isStudioMobileBot,
} from 'cli/remote-session/studio-mobile-client';
import { type RespondAction, buildTelegramRespondBody } from 'cli/remote-session/telegram-client';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

/**
 * Orchestrates "post a reply back to the user" for both Telegram and
 * studio-mobile bots. Picks the right client based on the bot identity,
 * delegates URL + body construction to that client, and handles the shared
 * HTTP concerns uniformly (retries on 5xx, auth/bad-request short-circuits,
 * the wpcom response envelope).
 *
 * Dispatches on `params.action` (default `create`):
 *   - `create` (text only)    — `application/json` body to /local-agent-respond
 *                                (Telegram) or `/studio-mobile-client/respond`
 *                                (mobile envelope).
 *   - `create` (text + photo) — Telegram only, `multipart/form-data` with the
 *                                raw photo bytes. Photos on a mobile bot are
 *                                folded into the envelope text by the mobile
 *                                client (bytes are dropped).
 *   - `edit`                  — Telegram only. Mobile has no edit primitive in
 *                                v1, so the router degrades it to a fresh
 *                                envelope `create` and returns a synthetic
 *                                outcome (empty `messageIds`, success: true)
 *                                so the progress streamer keeps streaming.
 */

export interface RespondParams {
	chatId: number;
	bot?: string;
	/**
	 * What to do on the server side. Defaults to `create` (sendMessage / sendPhoto
	 * on Telegram, append envelope on mobile).
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
	 * Empty on mobile (no message-id concept) and on any failure mode that
	 * didn't land a message.
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
 * POST a message back to the user. Retries up to 3 times on 5xx with exponential
 * backoff. 4xx responses surface as `RemoteBadRequestError` and should be logged
 * but not retried. The server always answers with HTTP 200 and a JSON body
 * indicating partial outcomes (`success`, `photo_sent`, `text_sent`,
 * `message_ids`, `retry_after_ms`, `error`); we log a warning when `success`
 * is false but do NOT throw on `retry_after_ms` — the caller inspects the
 * returned outcome and decides how long to back off.
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

	const bot = params.bot ?? config.bot;
	const isMobile = isStudioMobileBot( bot );

	// Mobile has no edit primitive in v1. Degrade to a fresh `create` envelope
	// — the progress streamer's `createFailed` fallback already handles the
	// resulting empty `messageIds` by issuing another `create` on the next
	// event, which yields a stream of agent_message envelopes (matches the
	// pre-trunk behavior on the mobile path).
	const effectiveAction: RespondAction = isMobile && action === 'edit' ? 'create' : action;

	const url = isMobile
		? buildMobileRespondUrl( config.base_url )
		: buildUrl( config.base_url, 'local-agent-respond' );
	const allowedHost = new URL( config.base_url ).host;
	assertSameHost( url, allowedHost );
	const { body, contentType } = isMobile
		? buildMobileRespondBody( {
				chatId: params.chatId,
				bot,
				machineId: config.machine_id,
				text,
				photo,
				caption,
				logger: options.logger,
		  } )
		: buildTelegramRespondBody( {
				chatId: params.chatId,
				bot,
				action: effectiveAction,
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
		action: effectiveAction,
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
			throw new RemoteAuthError( response.status );
		}
		if ( response.status >= 500 ) {
			logger?.warn( 'Respond 5xx', { status: response.status, attempt } );
			lastError = new RemoteTransientError(
				`Respond returned ${ response.status }`,
				response.status
			);
			await backoff( attempt );
			attempt++;
			continue;
		}
		if ( response.status >= 400 ) {
			const bodyText = await safeReadText( response );
			logger?.warn( 'Respond 4xx', {
				status: response.status,
				chat_id: params.chatId,
				body_preview: bodyText.slice( 0, 200 ),
			} );
			throw new RemoteBadRequestError(
				`Respond returned ${ response.status }${ bodyText ? `: ${ bodyText }` : '' }`,
				response.status
			);
		}
		if ( ! response.ok ) {
			logger?.warn( 'Respond unexpected status', { status: response.status } );
			throw new RemoteTransientError(
				`Respond returned unexpected status ${ response.status }`,
				response.status
			);
		}

		const raw = await readRespondOutcome( response );
		const outcome = toRespondOutcome( raw );
		if ( ! outcome.success ) {
			logger?.warn( 'Respond reported partial failure', {
				chat_id: params.chatId,
				action: effectiveAction,
				photo_sent: outcome.photoSent,
				text_sent: outcome.textSent,
				retry_after_ms: outcome.retryAfterMs,
				error: outcome.error,
			} );
		} else {
			logger?.debug( 'Respond ok', {
				status: response.status,
				chat_id: params.chatId,
				action: effectiveAction,
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
		action: effectiveAction,
		max_retries: maxRetries,
	} );
	if ( lastError instanceof Error ) {
		throw lastError;
	}
	throw new RemoteTransientError( 'Respond failed after retries' );
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
	// behavior where the server occasionally returned 200 with an empty body
	// (and the studio-mobile /respond endpoint returns `{ delivered: true }`
	// without `message_ids`).
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
