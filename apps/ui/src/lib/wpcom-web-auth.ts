import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';

// Browser-side WordPress.com OAuth for Studio Web's SecEx backend.
//
// Studio Code's `/studio-code/run` endpoint is called directly from the browser,
// so there's no local web-server to read the desktop's `~/.studio` token. Instead
// we run the same implicit OAuth flow the desktop uses (client 95109, scope
// `global`, `response_type=token`) but redirect back to the web origin and keep
// the resulting token in localStorage.
//
// NOTE: the OAuth app (client 95109) must list the web origin (e.g.
// `http://localhost:5300/`, and the production Studio Web origin) among its
// allowed redirect URIs, or WordPress.com rejects the redirect.

const TOKEN_KEY = 'studio-web-wpcom-token';

interface StoredWebToken {
	accessToken: string;
	expiresAt: number;
}

function redirectUri(): string {
	return `${ window.location.origin }/`;
}

function readStored(): StoredWebToken | null {
	try {
		const raw = window.localStorage.getItem( TOKEN_KEY );
		if ( ! raw ) {
			return null;
		}
		const parsed = JSON.parse( raw ) as Partial< StoredWebToken >;
		if ( typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number' ) {
			return null;
		}
		return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
	} catch {
		return null;
	}
}

// Reads `#access_token=…&expires_in=…` left in the URL after WordPress.com
// redirects back, stores it, and strips the fragment so the token never lingers
// in the address bar or in shareable links. Returns true when a token was found.
export function captureTokenFromHash(): boolean {
	const hash = window.location.hash.startsWith( '#' )
		? window.location.hash.slice( 1 )
		: window.location.hash;
	if ( ! hash ) {
		return false;
	}
	const params = new URLSearchParams( hash );
	const accessToken = params.get( 'access_token' );
	if ( ! accessToken ) {
		return false;
	}
	const expiresIn = parseInt( params.get( 'expires_in' ) ?? '0', 10 );
	const expiresAt = Date.now() + ( expiresIn > 0 ? expiresIn : 1209600 ) * 1000;
	try {
		window.localStorage.setItem( TOKEN_KEY, JSON.stringify( { accessToken, expiresAt } ) );
	} catch {
		// Ignore storage failures — the token is still usable for this load.
	}
	// Drop the fragment from the URL.
	window.history.replaceState( null, '', window.location.pathname + window.location.search );
	return true;
}

// Returns a non-expired token, or null. A one-minute skew keeps a soon-to-expire
// token from being handed to a long-running stream.
export function getStoredToken(): string | null {
	const stored = readStored();
	if ( ! stored ) {
		return null;
	}
	if ( stored.expiresAt - Date.now() < 60_000 ) {
		clearStoredToken();
		return null;
	}
	return stored.accessToken;
}

export function clearStoredToken(): void {
	try {
		window.localStorage.removeItem( TOKEN_KEY );
	} catch {
		// Ignore.
	}
}

// Sends the browser to WordPress.com to authorize; it returns to the web origin
// with the token in the URL fragment (handled by captureTokenFromHash on boot).
export function beginLogin(): void {
	window.location.assign( getAuthenticationUrl( DEFAULT_LOCALE, redirectUri() ) );
}
