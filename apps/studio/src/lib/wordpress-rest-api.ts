import { SiteServer } from 'src/site-server';
import type { SiteRestRequest, SiteRestResponse } from '@studio/common/types/wordpress-rest';
import type { IpcMainInvokeEvent } from 'electron';

interface SiteRestAuth {
	baseUrl: string;
	cookie: string;
	nonce: string;
}

const siteRestAuthCache = new Map< string, SiteRestAuth >();

export async function fetchSiteRest(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: SiteRestRequest
): Promise< SiteRestResponse > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		return createJsonResponse( 404, 'studio_site_not_found', `Site ${ siteId } not found.` );
	}

	if ( ! server.details.running ) {
		return createJsonResponse( 503, 'studio_site_not_running', `Site ${ siteId } is not running.` );
	}

	let url: URL;
	try {
		url = getSiteRestUrl( server, request );
	} catch ( error ) {
		return createJsonResponse(
			400,
			'studio_invalid_rest_request',
			error instanceof Error ? error.message : 'Invalid REST request.'
		);
	}

	return fetchSiteRestWithAuth( server, url, request, true );
}

async function fetchSiteRestWithAuth(
	server: SiteServer,
	url: URL,
	request: SiteRestRequest,
	allowAuthRefresh: boolean
): Promise< SiteRestResponse > {
	const baseUrl = getSiteBaseUrl( server );
	const headers = await getRequestHeaders( server, baseUrl, request.headers );
	if ( request.data !== undefined && ! hasHeader( headers, 'content-type' ) ) {
		headers[ 'Content-Type' ] = 'application/json';
	}
	const response = await fetch( url, {
		method: request.method ?? 'GET',
		headers,
		body: getRequestBody( request ),
		redirect: 'follow',
	} );

	if ( allowAuthRefresh && ( response.status === 401 || response.status === 403 ) ) {
		siteRestAuthCache.delete( server.details.id );
		return fetchSiteRestWithAuth( server, url, request, false );
	}

	return serializeResponse( response );
}

function getSiteBaseUrl( server: SiteServer ) {
	return server.server.url.replace( /\/+$/, '' );
}

function getSiteRestUrl( server: SiteServer, request: SiteRestRequest ) {
	const baseUrl = getSiteBaseUrl( server );
	const restRoot = new URL( '/wp-json/', baseUrl );

	if ( request.path ) {
		const path = request.path.replace( /^\/+/, '' );
		return new URL( path, restRoot );
	}

	if ( request.url ) {
		const url = new URL( request.url );
		if ( url.origin !== restRoot.origin || ! url.pathname.startsWith( restRoot.pathname ) ) {
			throw new Error( 'REST URL must target the selected site REST API.' );
		}
		return url;
	}

	throw new Error( 'REST request requires a path or URL.' );
}

async function getRequestHeaders(
	server: SiteServer,
	baseUrl: string,
	requestHeaders: Record< string, string > = {}
) {
	const headers = sanitizeRequestHeaders( requestHeaders );
	const auth = await getSiteRestAuth( server, baseUrl );

	if ( auth ) {
		headers.Cookie = auth.cookie;
		headers[ 'X-WP-Nonce' ] = auth.nonce;
	}

	return headers;
}

function sanitizeRequestHeaders( requestHeaders: Record< string, string > ) {
	const headers: Record< string, string > = {
		Accept: 'application/json, */*;q=0.1',
	};

	for ( const [ key, value ] of Object.entries( requestHeaders ) ) {
		const lowerKey = key.toLowerCase();
		if ( lowerKey === 'cookie' || lowerKey === 'host' ) {
			continue;
		}
		headers[ key ] = value;
	}

	return headers;
}

function hasHeader( headers: Record< string, string >, headerName: string ) {
	const normalizedHeaderName = headerName.toLowerCase();
	return Object.keys( headers ).some( ( key ) => key.toLowerCase() === normalizedHeaderName );
}

function getRequestBody( request: SiteRestRequest ) {
	if ( request.body !== undefined ) {
		return request.body;
	}

	if ( request.data !== undefined ) {
		return JSON.stringify( request.data );
	}

	return undefined;
}

async function getSiteRestAuth( server: SiteServer, baseUrl: string ) {
	const cached = siteRestAuthCache.get( server.details.id );
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
		siteRestAuthCache.set( server.details.id, auth );
		return auth;
	} catch ( error ) {
		console.warn( `Failed to prepare REST auth for site ${ server.details.id }:`, error );
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

function createJsonResponse( status: number, code: string, message: string ): SiteRestResponse {
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
