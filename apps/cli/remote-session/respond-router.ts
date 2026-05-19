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
import { buildTelegramRespondBody } from 'cli/remote-session/telegram-client';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

/**
 * Orchestrates "post a reply back to the user" for both Telegram and
 * studio-mobile bots. Picks the right client based on the bot identity,
 * delegates URL + body construction to that client, and handles the shared
 * HTTP concerns uniformly (retries on 5xx, auth/bad-request short-circuits,
 * Telegram's partial-success response interpretation).
 */

export interface RespondParams {
	chatId: number;
	bot?: string;
	/** Plain text reply. Required when no `photo` is provided. */
	text?: string;
	/**
	 * Base64-encoded image bytes (PNG or JPEG). When set, the request goes out as
	 * `multipart/form-data` so the server forwards it to Telegram via `sendPhoto`.
	 */
	photo?: string;
	/** MIME type of the photo bytes. Defaults to `image/png`. */
	photoMimeType?: 'image/png' | 'image/jpeg';
	/** Caption to send alongside `photo`. The server demotes long captions to a follow-up message. */
	caption?: string;
}

interface RespondResponseBody {
	success?: boolean;
	photo_sent?: boolean;
	text_sent?: boolean;
	chunks_sent?: number;
	error?: string;
}

/**
 * POST a message back to the user. Retries up to 3 times on 5xx with exponential
 * backoff. 4xx responses surface as `RemoteBadRequestError` and should be logged
 * but not retried.
 *
 * Two wire formats, picked from the `bot` field:
 *
 * 1. Telegram (default):
 *    - Text-only: `application/json` body — `{ chat_id, bot, text }`.
 *    - Photo (with optional caption / follow-up text): `multipart/form-data`
 *      with a binary `photo` file part plus text fields. The server validates
 *      the photo bytes (size + magic bytes) before forwarding to Telegram.
 *
 * 2. Studio mobile (`bot` starts with `studio_mobile_`):
 *    - Always `application/json` — `{ chat_id, bot, machine_id, envelope: { type: 'agent_message', id, text } }`.
 *    - Photos are out-of-scope for the mobile PoC (see studio-mobile SPEC.md
 *      "Out of scope for v1"); the mobile client folds any caption/text into
 *      the envelope and drops the image bytes.
 *
 * The Telegram server always answers with HTTP 200 and a JSON body indicating
 * partial outcomes (`success`, `photo_sent`, `text_sent`, `error`); we log a
 * warning when `success` is false but do not throw. The mobile `/respond`
 * endpoint just returns 200 with no body on success.
 */
export async function respondMessage(
	config: RemoteSessionConfig,
	params: RespondParams,
	options: { signal?: AbortSignal; maxRetries?: number; logger?: RemoteSessionLogger } = {}
): Promise< void > {
	// Normalize empty strings to "absent" so every downstream check (early
	// guard, body builder, debug log) agrees on what counts as present.
	const text = params.text && params.text.length > 0 ? params.text : undefined;
	const photo = params.photo && params.photo.length > 0 ? params.photo : undefined;

	if ( ! text && ! photo ) {
		throw new Error( 'respondMessage requires `text`, `photo`, or both' );
	}

	const bot = params.bot ?? config.bot;
	const isMobile = isStudioMobileBot( bot );
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
				caption: params.caption,
				logger: options.logger,
		  } )
		: buildTelegramRespondBody( {
				chatId: params.chatId,
				bot,
				text,
				photo,
				photoMimeType: params.photoMimeType,
				caption: params.caption,
		  } );

	const maxRetries = options.maxRetries ?? 3;
	let attempt = 0;
	let lastError: unknown;
	const logger = options.logger;
	logger?.debug( 'Respond start', {
		chat_id: params.chatId,
		bot,
		text_length: text?.length ?? 0,
		text_preview: text?.slice( 0, 120 ),
		has_photo: photo !== undefined,
		photo_base64_chars: photo?.length ?? 0,
		photo_mime_type: params.photoMimeType,
		caption_length: params.caption?.length ?? 0,
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

		const outcome = await readRespondOutcome( response );
		if ( outcome && outcome.success === false ) {
			logger?.warn( 'Respond reported partial failure', {
				chat_id: params.chatId,
				photo_sent: outcome.photo_sent,
				text_sent: outcome.text_sent,
				error: outcome.error,
			} );
		} else {
			logger?.debug( 'Respond ok', {
				status: response.status,
				chat_id: params.chatId,
				attempt,
				photo_sent: outcome?.photo_sent,
				text_sent: outcome?.text_sent,
				chunks_sent: outcome?.chunks_sent,
			} );
		}
		return;
	}

	logger?.error( 'Respond failed after retries', {
		chat_id: params.chatId,
		max_retries: maxRetries,
	} );
	if ( lastError instanceof Error ) {
		throw lastError;
	}
	throw new RemoteTransientError( 'Respond failed after retries' );
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
