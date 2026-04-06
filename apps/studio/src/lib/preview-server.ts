import fs from 'fs';
import http from 'http';
import path from 'path';

const MIME_TYPES: Record< string, string > = {
	'.html': 'text/html',
	'.css': 'text/css',
	'.js': 'application/javascript',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

let server: http.Server | null = null;
let serverPort = 0;
let servingRoot = '';

/**
 * Start a lightweight static file server for design previews.
 * Serves files from the given root directory on a random available port.
 * Returns the base URL (e.g. http://localhost:54321).
 * Reuses the same server if already running — just updates the root.
 */
export async function startPreviewServer( root: string ): Promise< string > {
	servingRoot = root;

	if ( server ) {
		return `http://localhost:${ serverPort }`;
	}

	return new Promise( ( resolve, reject ) => {
		server = http.createServer( ( req, res ) => {
			const urlPath = decodeURIComponent( new URL( req.url ?? '/', `http://localhost` ).pathname );
			const filePath = path.join( servingRoot, urlPath === '/' ? 'index.html' : urlPath );

			// Prevent path traversal
			if ( ! filePath.startsWith( servingRoot ) ) {
				res.writeHead( 403 );
				res.end( 'Forbidden' );
				return;
			}

			fs.readFile( filePath, ( err, data ) => {
				if ( err ) {
					res.writeHead( 404 );
					res.end( 'Not found' );
					return;
				}
				const ext = path.extname( filePath ).toLowerCase();
				const contentType = MIME_TYPES[ ext ] ?? 'application/octet-stream';
				res.writeHead( 200, { 'Content-Type': contentType } );
				res.end( data );
			} );
		} );

		// Listen on port 0 to get a random available port
		server.listen( 0, '127.0.0.1', () => {
			const addr = server!.address();
			if ( typeof addr === 'object' && addr ) {
				serverPort = addr.port;
				resolve( `http://localhost:${ serverPort }` );
			} else {
				reject( new Error( 'Failed to start preview server' ) );
			}
		} );

		server.on( 'error', reject );
	} );
}

/**
 * Stop the preview server if running.
 */
export function stopPreviewServer(): void {
	if ( server ) {
		server.close();
		server = null;
		serverPort = 0;
	}
}

/**
 * Get the current preview server base URL, or undefined if not running.
 */
export function getPreviewServerUrl(): string | undefined {
	return server ? `http://localhost:${ serverPort }` : undefined;
}
