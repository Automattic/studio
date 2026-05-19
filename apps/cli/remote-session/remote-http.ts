/**
 * Transport-layer primitives shared by the Telegram and studio-mobile clients
 * — error classes, URL helpers, and fetch/backoff utilities. None of this
 * knows about message shapes; it just gets bytes to and from the wpcom proxy.
 */

export class RemoteAuthError extends Error {
	constructor( public readonly status: number ) {
		super( `Remote server returned auth error (HTTP ${ status })` );
		this.name = 'RemoteAuthError';
	}
}

export class RemoteTransientError extends Error {
	constructor(
		message: string,
		public readonly status?: number
	) {
		super( message );
		this.name = 'RemoteTransientError';
	}
}

export class RemoteBadRequestError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super( message );
		this.name = 'RemoteBadRequestError';
	}
}

export function assertSameHost( urlString: string, allowedHost: string ): void {
	const u = new URL( urlString );
	if ( u.host !== allowedHost ) {
		throw new RemoteTransientError(
			`Refusing to follow redirect to different host: ${ u.host } (allowed: ${ allowedHost })`
		);
	}
}

function normalizeBase( base: string ): URL {
	// Ensure a trailing slash so relative path joins work predictably.
	return new URL( base.endsWith( '/' ) ? base : `${ base }/` );
}

export function buildUrl( baseUrl: string, pathName: string ): string {
	const base = normalizeBase( baseUrl );
	const joined = new URL( pathName.replace( /^\//, '' ), base );
	return joined.toString();
}

export async function safeReadText( response: Response ): Promise< string > {
	try {
		return await response.text();
	} catch {
		return '';
	}
}

export async function backoff( attempt: number ): Promise< void > {
	const baseMs = Math.min( 30_000, 500 * Math.pow( 2, attempt ) );
	const jitter = Math.random() * 200;
	await new Promise( ( resolve ) => setTimeout( resolve, baseMs + jitter ) );
}

export function composeSignals( a?: AbortSignal, b?: AbortSignal ): AbortSignal | undefined {
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
