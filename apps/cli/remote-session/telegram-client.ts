import {
	RemoteAuthError,
	RemoteTransientError,
	assertSameHost,
	buildUrl,
	composeSignals,
} from 'cli/remote-session/remote-http';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RemoteSessionLogger } from 'cli/remote-session/logger';

/**
 * Wire-format adapter for the wpcom `telegram-bot/local-agent-{poll,respond}`
 * endpoints. Only the Telegram-side concerns live here — the studio-mobile
 * `/respond` shape is in `studio-mobile-client.ts`, and the routing decision
 * + retry loop live in `respond-router.ts`.
 */

export interface PolledMessage {
	chat_id: number;
	text: string;
	bot?: string;
}

export interface TelegramRequestContext {
	logger?: RemoteSessionLogger;
}

/**
 * Action the wpcom side should perform with the request body. Used by both
 * the Telegram and studio-mobile paths, so it's exported here as the shared
 * vocabulary (the router builds the actual wire body via the per-transport
 * adapters).
 *
 *  - `create` (default): Telegram sendMessage / sendPhoto, or a new
 *    studio-mobile envelope appended to the outbound queue.
 *  - `edit`: Telegram editMessageText against the captured `message_id`.
 *    Studio mobile has no edit primitive today, so the router degrades it
 *    to a fresh `create` envelope.
 */
export type RespondAction = 'create' | 'edit';

/**
 * Poll the server for pending messages. Returns an empty array when nothing is queued.
 *
 * The server returns `{ messages: [ { message, chat_id, bot, user_id, timestamp }, ... ] }`.
 * A batch can contain any number of messages; the caller is expected to drain them in order
 * (one `studio code --json` turn per message) before polling again.
 *
 * Throws RemoteAuthError on 401/403, RemoteTransientError on 5xx or network errors.
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
		throw new RemoteTransientError( `Network error polling Telegram: ${ message }` );
	} finally {
		clearTimeout( timeoutId );
	}

	if ( response.status === 401 || response.status === 403 ) {
		context.logger?.error( 'Poll auth error', { status: response.status } );
		throw new RemoteAuthError( response.status );
	}
	if ( response.status >= 500 ) {
		context.logger?.warn( 'Poll 5xx', { status: response.status } );
		throw new RemoteTransientError( `Poll returned ${ response.status }`, response.status );
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
		throw new RemoteTransientError(
			`Unexpected redirect from poll endpoint: HTTP ${ response.status }`,
			response.status
		);
	}
	if ( ! response.ok ) {
		context.logger?.warn( 'Poll unexpected status', { status: response.status } );
		throw new RemoteTransientError(
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

export interface TelegramBodyParams {
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

export function buildTelegramRespondBody( params: TelegramBodyParams ): {
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
