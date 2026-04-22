import { type RemoteSessionConfig } from 'cli/remote-session/config';

export interface PolledMessage {
	chat_id: number;
	text: string;
	bot?: string;
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
	signal?: AbortSignal
): Promise< PolledMessage[] > {
	const url = buildUrl( config.base_url, 'local-agent-poll' );
	const allowedHost = new URL( config.base_url ).host;
	assertSameHost( url, allowedHost );

	const controller = new AbortController();
	const timeoutId = setTimeout( () => controller.abort(), config.long_poll_timeout_seconds * 1000 );
	const composite = composeSignals( signal, controller.signal );

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
			return [];
		}
		throw new TelegramTransientError(
			`Network error polling Telegram: ${ ( error as Error ).message ?? 'unknown' }`
		);
	} finally {
		clearTimeout( timeoutId );
	}

	if ( response.status === 401 || response.status === 403 ) {
		throw new TelegramAuthError( response.status );
	}
	if ( response.status >= 500 ) {
		throw new TelegramTransientError( `Poll returned ${ response.status }`, response.status );
	}
	if ( response.status === 204 ) {
		return [];
	}
	if ( response.status >= 300 && response.status < 400 ) {
		// Never follow server-issued redirects blindly.
		throw new TelegramTransientError(
			`Unexpected redirect from poll endpoint: HTTP ${ response.status }`,
			response.status
		);
	}
	if ( ! response.ok ) {
		throw new TelegramTransientError(
			`Poll returned unexpected status ${ response.status }`,
			response.status
		);
	}

	const text = await response.text();
	if ( ! text.trim() ) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse( text );
	} catch {
		return [];
	}
	return extractMessages( parsed );
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

/**
 * POST a message back to Telegram. Retries up to 3 times on 5xx with exponential backoff.
 * 4xx responses are surfaced as TelegramBadRequestError and should be logged but not retried.
 */
export async function respondMessage(
	config: RemoteSessionConfig,
	params: { chatId: number; text: string; bot?: string },
	options: { signal?: AbortSignal; maxRetries?: number } = {}
): Promise< void > {
	const url = buildUrl( config.base_url, 'local-agent-respond' );
	const allowedHost = new URL( config.base_url ).host;
	assertSameHost( url, allowedHost );

	const body = JSON.stringify( {
		chat_id: params.chatId,
		text: params.text,
		bot: params.bot ?? config.bot,
	} );

	const maxRetries = options.maxRetries ?? 3;
	let attempt = 0;
	let lastError: unknown;

	while ( attempt <= maxRetries ) {
		let response: Response;
		try {
			response = await fetch( url, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${ config.token }`,
					'Content-Type': 'application/json',
				},
				body,
				redirect: 'manual',
				signal: options.signal,
			} );
		} catch ( error ) {
			lastError = error;
			if ( error instanceof Error && error.name === 'AbortError' ) {
				throw error;
			}
			await backoff( attempt );
			attempt++;
			continue;
		}

		if ( response.status === 401 || response.status === 403 ) {
			throw new TelegramAuthError( response.status );
		}
		if ( response.status >= 500 ) {
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
			throw new TelegramBadRequestError(
				`Respond returned ${ response.status }${ text ? `: ${ text }` : '' }`,
				response.status
			);
		}
		if ( ! response.ok ) {
			throw new TelegramTransientError(
				`Respond returned unexpected status ${ response.status }`,
				response.status
			);
		}
		return;
	}

	if ( lastError instanceof Error ) {
		throw lastError;
	}
	throw new TelegramTransientError( 'Respond failed after retries' );
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
