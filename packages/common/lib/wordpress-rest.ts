import type { SiteRestRequest, SiteRestResponse } from '@studio/common/types/wordpress-rest';

/** Where to send a site's REST request. */
export interface SiteRestTarget {
	siteId: string;
	running: boolean;
	// Loopback base the request is actually sent to, e.g. http://127.0.0.1:<port>.
	baseUrl: string;
}

interface SiteRestAuth {
	baseUrl: string;
	cookie: string;
	nonce: string;
}

const siteRestAuthCache = new Map< string, SiteRestAuth >();

/** Proxy a WordPress REST request to a running local site. */
export async function fetchSiteRest(
	target: SiteRestTarget,
	request: SiteRestRequest
): Promise< SiteRestResponse > {
	if ( ! target.running ) {
		return createJsonResponse(
			503,
			'studio_site_not_running',
			`Site ${ target.siteId } is not running.`
		);
	}

	let url: URL;
	try {
		url = getSiteRestUrl( target, request );
	} catch ( error ) {
		return createJsonResponse(
			400,
			'studio_invalid_rest_request',
			error instanceof Error ? error.message : 'Invalid REST request.'
		);
	}

	return fetchSiteRestWithAuth( target, url, true );
}

export function createJsonResponse(
	status: number,
	code: string,
	message: string
): SiteRestResponse {
	return {
		status,
		statusText: status >= 500 ? 'Server Error' : 'Error',
		headers: {
			'content-type': 'application/json',
		},
		body: JSON.stringify( { code, message } ),
		url: '',
	};
}

async function fetchSiteRestWithAuth(
	target: SiteRestTarget,
	url: URL,
	allowAuthRefresh: boolean
): Promise< SiteRestResponse > {
	const headers = await getRequestHeaders( target, target.baseUrl );
	let response: Response;
	try {
		response = await fetch( url, {
			headers,
			redirect: 'follow',
		} );
	} catch ( error ) {
		// A site can be marked running while nothing listens on its port
		// (stale state, crashed server). Degrade to a response instead of
		// rejecting through the IPC handler.
		return createJsonResponse(
			502,
			'studio_site_unreachable',
			`Site ${ target.siteId } did not respond: ${
				error instanceof Error ? error.message : String( error )
			}`
		);
	}

	if ( allowAuthRefresh && ( response.status === 401 || response.status === 403 ) ) {
		siteRestAuthCache.delete( target.siteId );
		return fetchSiteRestWithAuth( target, url, false );
	}

	return serializeResponse( response );
}

function getSiteRestUrl( target: SiteRestTarget, request: SiteRestRequest ) {
	const restRoot = new URL( '/wp-json/', target.baseUrl );

	// Resolve against the site's REST root, then reject anything that escapes
	// it. Without this check an absolute URL in `path` (e.g. `http://evil/`)
	// overrides the base, letting the request target an arbitrary host with
	// the site's auth cookie + nonce attached (SSRF + credential leak).
	const url = new URL( request.path.replace( /^\/+/, '' ), restRoot );
	if ( ! isRestUrlForRoot( url, restRoot ) ) {
		throw new Error( 'REST path must stay within the site REST API.' );
	}
	return url;
}

function isRestUrlForRoot( url: URL, restRoot: URL ) {
	return url.origin === restRoot.origin && url.pathname.startsWith( restRoot.pathname );
}

async function getRequestHeaders( target: SiteRestTarget, baseUrl: string ) {
	const headers: Record< string, string > = {
		Accept: 'application/json, */*;q=0.1',
	};
	const auth = await getSiteRestAuth( target, baseUrl );

	if ( auth ) {
		headers.Cookie = auth.cookie;
		headers[ 'X-WP-Nonce' ] = auth.nonce;
	}

	return headers;
}

async function getSiteRestAuth( target: SiteRestTarget, baseUrl: string ) {
	const cached = siteRestAuthCache.get( target.siteId );
	if ( cached?.baseUrl === baseUrl ) {
		return cached;
	}

	try {
		const cookie = await getAutoLoginCookie( baseUrl );
		const nonce = await getRestNonce( baseUrl, cookie );
		const auth = {
			baseUrl,
			cookie,
			nonce,
		};
		siteRestAuthCache.set( target.siteId, auth );
		return auth;
	} catch ( error ) {
		console.warn( `Failed to prepare REST auth for site ${ target.siteId }:`, error );
		return null;
	}
}

async function getAutoLoginCookie( baseUrl: string ) {
	const loginUrl = new URL( '/studio-auto-login', baseUrl );
	loginUrl.searchParams.set( 'redirect_to', '/wp-admin/' );

	const response = await fetch( loginUrl, { redirect: 'manual' } );
	const cookies = getSetCookies( response.headers )
		.map( ( cookie ) => cookie.split( ';' )[ 0 ] )
		.filter( Boolean );

	if ( cookies.length === 0 ) {
		throw new Error( 'Auto-login did not return authentication cookies.' );
	}

	return cookies.join( '; ' );
}

async function getRestNonce( baseUrl: string, cookie: string ) {
	const nonceUrl = new URL( '/wp-admin/admin-ajax.php', baseUrl );
	nonceUrl.searchParams.set( 'action', 'rest-nonce' );

	const response = await fetch( nonceUrl, {
		headers: {
			Cookie: cookie,
		},
	} );
	if ( ! response.ok ) {
		throw new Error( `REST nonce request failed with status ${ response.status }.` );
	}

	const nonce = ( await response.text() ).trim();
	if ( ! nonce ) {
		throw new Error( 'REST nonce response was empty.' );
	}
	return nonce;
}

function getSetCookies( headers: Headers ) {
	const headersWithSetCookie = headers as Headers & { getSetCookie?: () => string[] };
	const setCookies = headersWithSetCookie.getSetCookie?.();
	if ( setCookies?.length ) {
		return setCookies;
	}

	const setCookieHeader = headers.get( 'set-cookie' );
	return setCookieHeader ? splitCombinedSetCookieHeader( setCookieHeader ) : [];
}

function splitCombinedSetCookieHeader( header: string ) {
	return header.split( /,(?=\s*[^;,]+=)/ ).map( ( value ) => value.trim() );
}

async function serializeResponse( response: Response ): Promise< SiteRestResponse > {
	return {
		status: response.status,
		statusText: response.statusText,
		headers: Object.fromEntries( response.headers.entries() ),
		body: await response.text(),
		url: response.url,
	};
}
