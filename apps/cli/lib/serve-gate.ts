import { readConfig } from '@studio/common/lib/config/store';
import { signToken, verifyToken } from '@studio/common/lib/signed-token';
import httpProxy from 'http-proxy';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * What `studio serve` checks before any route of the local server runs. The API answers only
 * requests carrying a session the control plane signed with this machine's secret, as a bearer
 * token or as the cookie `POST /api/cloud/login` sets from one. Sites are private: a request
 * addressed to a site's host reaches it with a site-access cookie, which the API host hands a
 * signed-in user, or over loopback, from the machine itself.
 */
export interface ServeGateOptions {
	secret: string;
	// The machine the control plane signs sessions for (`aud`), when there is one.
	machineId?: string;
	// The public origin of the API, where a site sends a visitor to get access.
	apiOrigin?: string;
	// Appended to a site's id to form its host, such as `--m123.cloud.example`.
	siteHostSuffix?: string;
	allowedOrigins: string[];
	// Let requests from the machine itself reach its sites without access. On by default.
	trustLoopback?: boolean;
}

const SESSION_COOKIE = 'studio_serve_session';
const SITE_COOKIE = 'studio_site_access';
const SITE_ACCESS_SECONDS = 12 * 60 * 60;
const HANDOFF_SECONDS = 60;

type Next = ( error?: unknown ) => void;

function readCookie( req: IncomingMessage, name: string ): string | undefined {
	for ( const part of ( req.headers.cookie ?? '' ).split( ';' ) ) {
		const [ key, ...value ] = part.trim().split( '=' );
		if ( key === name ) {
			return decodeURIComponent( value.join( '=' ) );
		}
	}
	return undefined;
}

function isHttps( req: IncomingMessage ): boolean {
	return req.headers[ 'x-forwarded-proto' ] === 'https';
}

function cookie( req: IncomingMessage, name: string, value: string, maxAge: number ): string {
	const secure = isHttps( req ) ? '; Secure' : '';
	return `${ name }=${ encodeURIComponent(
		value
	) }; Path=/; Max-Age=${ maxAge }; HttpOnly; SameSite=Lax${ secure }`;
}

function isLoopback( req: IncomingMessage ): boolean {
	const address = req.socket.remoteAddress ?? '';
	return address === '::1' || address.startsWith( '127.' ) || address.startsWith( '::ffff:127.' );
}

function hostOf( req: IncomingMessage ): string {
	return ( req.headers.host ?? '' ).replace( /:\d+$/, '' ).toLowerCase();
}

function sendJson( res: ServerResponse, status: number, body: unknown ) {
	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.end( JSON.stringify( body ) );
}

/**
 * `value` as a path on `origin`, or null when it would lead anywhere else: an absolute URL, or
 * one browsers read as another host (`//evil.example`, `/\evil.example`).
 */
function pathOn( origin: string, value: string ): string | null {
	try {
		const url = new URL( value, origin );
		return url.origin === origin ? url.pathname + url.search : null;
	} catch {
		return null;
	}
}

function redirect( res: ServerResponse, location: string ) {
	res.statusCode = 302;
	res.setHeader( 'Location', location );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end();
}

async function findSitePort( host: string ): Promise< number | undefined > {
	const { sites } = await readConfig();
	const site = sites.find( ( candidate ) => {
		try {
			return new URL( getSiteUrl( candidate ) ).hostname === host;
		} catch {
			return false;
		}
	} );
	return site?.port;
}

export function createServeGate( options: ServeGateOptions ) {
	const proxy = httpProxy.createProxyServer( { xfwd: true } );
	// Studio lets wp-admin and phpMyAdmin be framed by a UI on localhost; the UI framing them here
	// is on another origin. And a site's redirects change as it's built, so no browser may keep one.
	proxy.on( 'proxyRes', ( proxyRes ) => {
		const policy = proxyRes.headers[ 'content-security-policy' ];
		if ( policy && options.allowedOrigins.length ) {
			const extra = options.allowedOrigins.join( ' ' );
			const widen = ( value: string ) =>
				value.replace( /frame-ancestors([^;,]*)/g, `frame-ancestors$1 ${ extra }` );
			proxyRes.headers[ 'content-security-policy' ] = Array.isArray( policy )
				? policy.map( widen )
				: widen( policy );
		}
		const status = proxyRes.statusCode ?? 0;
		if ( status >= 300 && status < 400 ) {
			proxyRes.headers[ 'cache-control' ] = 'no-store';
		}
	} );
	proxy.on( 'error', ( _error, _req, res ) => {
		if ( res instanceof Object && 'writeHead' in res && ! res.headersSent ) {
			( res as ServerResponse ).writeHead( 502, { 'Content-Type': 'text/plain' } );
			( res as ServerResponse ).end( 'This site is not running. Start it in WordPress Studio.' );
		}
	} );

	async function sessionFrom( req: IncomingMessage ) {
		const bearer = req.headers.authorization?.match( /^Bearer (.+)$/ )?.[ 1 ];
		const token = bearer ?? readCookie( req, SESSION_COOKIE );
		if ( ! token ) {
			return null;
		}
		const claims = await verifyToken( token, options.secret, 'session' );
		if ( ! claims || ( options.machineId && claims.aud !== options.machineId ) ) {
			return null;
		}
		return { token, claims };
	}

	async function handleSite( req: IncomingMessage, res: ServerResponse, host: string ) {
		const url = new URL( req.url ?? '/', `https://${ host }` );

		if ( url.pathname === '/__studio/access' ) {
			const handoff = await verifyToken(
				url.searchParams.get( 't' ) ?? '',
				options.secret,
				'site-handoff'
			);
			const back = pathOn( url.origin, url.searchParams.get( 'return' ) ?? '/' );
			if ( ! handoff || handoff.host !== host || ! back ) {
				sendJson( res, 403, { error: 'Access link expired' } );
				return;
			}
			const access = await signToken(
				{ purpose: 'site', host, exp: Math.floor( Date.now() / 1000 ) + SITE_ACCESS_SECONDS },
				options.secret
			);
			res.setHeader( 'Set-Cookie', cookie( req, SITE_COOKIE, access, SITE_ACCESS_SECONDS ) );
			redirect( res, back );
			return;
		}

		// The machine itself reaches its sites over loopback (see `serve-local-tls`); everyone else
		// needs the access a signed-in user gets through the API host.
		const access = await verifyToken(
			readCookie( req, SITE_COOKIE ) ?? '',
			options.secret,
			'site'
		);
		const local = options.trustLoopback !== false && isLoopback( req );
		if ( ! local && ( ! access || access.host !== host ) ) {
			const isPage = req.method === 'GET' && ( req.headers.accept ?? '' ).includes( 'text/html' );
			if ( ! isPage || ! options.apiOrigin ) {
				sendJson( res, 401, { error: 'Sign in to WordPress Studio to open this site' } );
				return;
			}
			const accessUrl = new URL( '/api/cloud/site-access', options.apiOrigin );
			accessUrl.searchParams.set( 'return', url.href );
			redirect( res, accessUrl.href );
			return;
		}

		const port = await findSitePort( host );
		if ( ! port ) {
			sendJson( res, 404, { error: 'No such site' } );
			return;
		}
		proxy.web( req, res, { target: `http://127.0.0.1:${ port }` } );
	}

	async function handleApi( req: IncomingMessage, res: ServerResponse, next: Next ) {
		const path = ( req.url ?? '/' ).split( '?' )[ 0 ];
		if ( req.method === 'OPTIONS' || path === '/api/health' || path === '/api/version' ) {
			next();
			return;
		}

		const origin = req.headers.origin;
		if ( origin && options.allowedOrigins.includes( origin ) ) {
			res.setHeader( 'Access-Control-Allow-Origin', origin );
			res.setHeader( 'Access-Control-Allow-Credentials', 'true' );
			res.setHeader( 'Vary', 'Origin' );
		}

		const session = await sessionFrom( req );
		if ( ! session ) {
			sendJson( res, 401, { error: 'Not signed in' } );
			return;
		}

		if ( path === '/api/cloud/login' && req.method === 'POST' ) {
			const maxAge = Math.max( 0, Math.floor( session.claims.exp - Date.now() / 1000 ) );
			res.setHeader( 'Set-Cookie', cookie( req, SESSION_COOKIE, session.token, maxAge ) );
			res.statusCode = 204;
			res.end();
			return;
		}

		if ( path === '/api/cloud/logout' && req.method === 'POST' ) {
			res.setHeader( 'Set-Cookie', cookie( req, SESSION_COOKIE, '', 0 ) );
			res.statusCode = 204;
			res.end();
			return;
		}

		if ( path === '/api/cloud/site-access' ) {
			const target = new URL( req.url ?? '/', 'http://serve' ).searchParams.get( 'return' ) ?? '';
			let back: URL;
			try {
				back = new URL( target );
			} catch {
				sendJson( res, 400, { error: 'Invalid return address' } );
				return;
			}
			if (
				! options.siteHostSuffix ||
				! [ 'https:', 'http:' ].includes( back.protocol ) ||
				! back.hostname.endsWith( options.siteHostSuffix )
			) {
				sendJson( res, 400, { error: 'Not a site on this machine' } );
				return;
			}
			const handoff = await signToken(
				{
					purpose: 'site-handoff',
					host: back.hostname,
					exp: Math.floor( Date.now() / 1000 ) + HANDOFF_SECONDS,
				},
				options.secret
			);
			const accessUrl = new URL( '/__studio/access', back.origin );
			accessUrl.searchParams.set( 't', handoff );
			accessUrl.searchParams.set( 'return', back.pathname + back.search );
			redirect( res, accessUrl.href );
			return;
		}

		next();
	}

	return ( req: IncomingMessage, res: ServerResponse, next: Next ) => {
		const host = hostOf( req );
		const apiHost = options.apiOrigin ? new URL( options.apiOrigin ).hostname : undefined;
		const work =
			options.siteHostSuffix && host !== apiHost && host.endsWith( options.siteHostSuffix )
				? handleSite( req, res, host )
				: handleApi( req, res, next );
		work.catch( next );
	};
}
