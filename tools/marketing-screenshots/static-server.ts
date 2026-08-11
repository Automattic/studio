import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export interface StaticServer {
	origin: string;
	close: () => Promise< void >;
}

const MIME_TYPES: Record< string, string > = {
	'.css': 'text/css; charset=utf-8',
	'.gif': 'image/gif',
	'.html': 'text/html; charset=utf-8',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml; charset=utf-8',
	'.wasm': 'application/wasm',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

export async function startStaticServer( distDirectory: string ): Promise< StaticServer > {
	const root = path.resolve( distDirectory );
	const indexPath = [ 'index.marketing.html', 'index.html' ]
		.map( ( fileName ) => path.join( root, fileName ) )
		.find( isFile );
	const marketingPreviewPath = path.join( root, 'marketing-preview', 'meridian', 'index.html' );

	if ( ! indexPath ) {
		throw new Error(
			`Marketing UI build not found in ${ root }. Expected index.marketing.html or index.html; ` +
				'build apps/ui/dist-marketing first.'
		);
	}

	const server = createServer( ( request, response ) => {
		if ( request.method !== 'GET' && request.method !== 'HEAD' ) {
			response.writeHead( 405, { Allow: 'GET, HEAD' } );
			response.end();
			return;
		}

		let pathname: string;
		try {
			pathname = decodeURIComponent( new URL( request.url ?? '/', 'http://localhost' ).pathname );
		} catch {
			response.writeHead( 400 );
			response.end( 'Bad request' );
			return;
		}

		if ( pathname === '/favicon.ico' && ! isFile( path.join( root, 'favicon.ico' ) ) ) {
			response.writeHead( 204, { 'Cache-Control': 'no-store' } );
			response.end();
			return;
		}

		const candidate = path.resolve( root, `.${ pathname }` );
		const isInsideRoot = candidate === root || candidate.startsWith( `${ root }${ path.sep }` );
		if ( ! isInsideRoot ) {
			response.writeHead( 403 );
			response.end( 'Forbidden' );
			return;
		}

		const isMarketingPreviewRequest =
			pathname === '/' &&
			request.headers[ 'sec-fetch-dest' ] === 'iframe' &&
			isFile( marketingPreviewPath );
		let filePath = isMarketingPreviewRequest ? marketingPreviewPath : candidate;
		if ( ! isMarketingPreviewRequest && ( pathname === '/' || ! isFile( candidate ) ) ) {
			const hasFileExtension = path.extname( pathname ) !== '';
			if ( pathname !== '/' && hasFileExtension ) {
				response.writeHead( 404 );
				response.end( 'Not found' );
				return;
			}
			filePath = indexPath;
		}

		response.writeHead( 200, {
			'Cache-Control': 'no-store',
			'Content-Type':
				MIME_TYPES[ path.extname( filePath ).toLowerCase() ] ?? 'application/octet-stream',
		} );

		if ( request.method === 'HEAD' ) {
			response.end();
			return;
		}

		createReadStream( filePath ).pipe( response );
	} );

	await new Promise< void >( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( 0, '127.0.0.1', () => {
			server.off( 'error', reject );
			resolve();
		} );
	} );

	const address = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${ address.port }`,
		close: () =>
			new Promise< void >( ( resolve, reject ) => {
				server.close( ( error ) => ( error ? reject( error ) : resolve() ) );
				server.closeAllConnections();
			} ),
	};
}

function isFile( filePath: string ): boolean {
	try {
		return statSync( filePath ).isFile();
	} catch {
		return false;
	}
}
