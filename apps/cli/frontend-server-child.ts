/**
 * Studio Headless Frontend Server Child Process
 *
 * Managed by the process manager daemon, this child serves the static frontend of a headless site
 * and reverse-proxies WordPress paths (REST API, wp-admin, wp-content, …) to the always-present
 * WordPress backend. It self-starts from environment config — there is no `start-server` handshake
 * like the WordPress children — and emits a single `ready` message once it is listening.
 *
 * Env config (set by `startFrontendServer` in wordpress-server-manager.ts):
 * - STUDIO_FRONTEND_PORT   the public port the frontend listens on (the site's top-level `port`)
 * - STUDIO_FRONTEND_PATH   directory of static files to serve
 * - STUDIO_WP_BACKEND_URL  base URL of the WordPress backend (e.g. http://localhost:<wpPort>)
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import httpProxy from 'http-proxy';
import { isWordPressRequest } from 'cli/lib/headless-routing';

const frontendPort = Number( process.env.STUDIO_FRONTEND_PORT );
const frontendPath = process.env.STUDIO_FRONTEND_PATH ?? '';
const backendUrl = process.env.STUDIO_WP_BACKEND_URL ?? '';

function log( message: string ): void {
	console.error( `[frontend-server] ${ message }` );
}

const CONTENT_TYPES: Record< string, string > = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor( filePath: string ): string {
	return CONTENT_TYPES[ path.extname( filePath ).toLowerCase() ] ?? 'application/octet-stream';
}

/**
 * Resolve a request path to a file inside `frontendPath`, guarding against path traversal.
 * Returns null when the request escapes the root.
 */
function resolveStaticFile( reqUrl: string ): string | null {
	const pathname = decodeURIComponent( reqUrl.split( '?' )[ 0 ] );
	const relativePath = pathname === '/' ? 'index.html' : pathname.replace( /^\/+/, '' );
	const resolved = path.resolve( frontendPath, relativePath );
	const root = path.resolve( frontendPath );
	if ( resolved !== root && ! resolved.startsWith( root + path.sep ) ) {
		return null;
	}
	return resolved;
}

function serveStatic( req: http.IncomingMessage, res: http.ServerResponse ): void {
	const filePath = resolveStaticFile( req.url ?? '/' );
	if ( ! filePath ) {
		res.writeHead( 403 );
		res.end( 'Forbidden' );
		return;
	}

	fs.stat( filePath, ( err, stats ) => {
		if ( err || ! stats.isFile() ) {
			res.writeHead( 404, { 'Content-Type': 'text/plain; charset=utf-8' } );
			res.end( 'Not found' );
			return;
		}

		res.writeHead( 200, { 'Content-Type': contentTypeFor( filePath ) } );
		fs.createReadStream( filePath )
			.on( 'error', () => {
				if ( ! res.headersSent ) {
					res.writeHead( 500 );
				}
				res.end();
			} )
			.pipe( res );
	} );
}

// `changeOrigin` rewrites the Host header to the backend's host:port so it matches WordPress's
// configured siteurl — otherwise WordPress issues a canonical redirect back to its own port and the
// proxied request (e.g. /wp-json) never resolves through the frontend.
const proxy = httpProxy.createProxyServer( { target: backendUrl, changeOrigin: true } );
proxy.on( 'error', ( err, _req, res ) => {
	log( `Proxy error: ${ err.message }` );
	if ( res instanceof http.ServerResponse && ! res.headersSent ) {
		res.writeHead( 502, { 'Content-Type': 'text/plain; charset=utf-8' } );
		res.end( 'WordPress backend is not reachable.' );
	}
} );

const server = http.createServer( ( req, res ) => {
	if ( isWordPressRequest( req.url ?? '/' ) ) {
		proxy.web( req, res );
		return;
	}
	serveStatic( req, res );
} );

function shutdown(): void {
	try {
		server.close();
		proxy.close();
	} catch {
		// Best effort.
	}
	process.exit( 0 );
}

process.on( 'SIGTERM', shutdown );
process.on( 'SIGINT', shutdown );
process.on( 'disconnect', shutdown );

server.on( 'error', ( err ) => {
	log( `Failed to start frontend server: ${ err.message }` );
	process.exit( 1 );
} );

server.listen( frontendPort, () => {
	log(
		`Serving ${ frontendPath } on port ${ frontendPort }, proxying WordPress to ${ backendUrl }`
	);
	if ( process.send ) {
		process.send( { topic: 'ready' } );
	}
} );
