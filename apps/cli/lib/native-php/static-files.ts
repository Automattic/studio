import fs from 'fs';
import path from 'path';
import type http from 'http';

// Static files that PHP's built-in server has served once are served by the proxy from then on.
// Each `php -S` worker handles one request at a time, so a static file sent to PHP waits for a
// worker: page loads queue their scripts and stylesheets behind PHP requests, and a site whose
// workers are all waiting on their own requests for files on the same site, such as
// `download_url()` for a theme image, hangs until those requests time out.
//
// PHP stays in charge of which paths are public and of their content types: the proxy only
// serves a path after PHP has served it as a static file, with the content type PHP sent. PHP's
// responses also get validators, so browsers revalidate instead of downloading every file again.
export class StaticFiles {
	// Content types of the URL paths PHP has served as static files.
	private readonly servedPaths = new Map< string, string >();

	constructor( private readonly sitePath: string ) {}

	// Answers a request for a static file PHP has served before and returns true, or returns false
	// to leave the request to PHP.
	answer( req: http.IncomingMessage, res: http.ServerResponse ): boolean {
		const urlPath = getUrlPath( req );
		const contentType = urlPath && this.servedPaths.get( urlPath );
		const file = contentType && this.getFile( urlPath );
		if ( ! file ) {
			return false;
		}

		const ifNoneMatch = req.headers[ 'if-none-match' ];
		if ( ifNoneMatch?.split( ',' ).some( ( tag ) => tag.trim() === file.validators.ETag ) ) {
			res.writeHead( 304, file.validators );
			res.end();
			return true;
		}

		res.writeHead( 200, {
			...file.validators,
			'Content-Type': contentType,
			'Content-Length': file.size,
		} );
		if ( req.method === 'HEAD' ) {
			res.end();
			return true;
		}
		fs.createReadStream( file.path )
			.on( 'error', () => res.destroy() )
			.pipe( res );
		return true;
	}

	// Adds validators to PHP's successful response for an existing static file, and remembers the
	// path so the proxy serves it from now on.
	addValidators(
		req: http.IncomingMessage,
		statusCode: number | undefined,
		headers: http.IncomingHttpHeaders
	): void {
		const urlPath = getUrlPath( req );
		const file = statusCode === 200 && urlPath && this.getFile( urlPath );
		if ( ! file ) {
			return;
		}

		const contentType = headers[ 'content-type' ];
		if ( contentType ) {
			this.servedPaths.set( urlPath, contentType );
		}
		headers.etag = file.validators.ETag;
		headers[ 'last-modified' ] = file.validators[ 'Last-Modified' ];
		headers[ 'cache-control' ] = file.validators[ 'Cache-Control' ];
	}

	private getFile( urlPath: string ) {
		const filePath = path.join( this.sitePath, urlPath );
		if (
			urlPath.toLowerCase().endsWith( '.php' ) ||
			! filePath.startsWith( path.join( this.sitePath, path.sep ) )
		) {
			return null;
		}

		let stats: fs.Stats;
		try {
			stats = fs.statSync( filePath );
		} catch {
			return null;
		}
		if ( ! stats.isFile() ) {
			return null;
		}

		return {
			path: filePath,
			size: stats.size,
			validators: {
				ETag: `W/"${ stats.size.toString( 16 ) }-${ Math.floor( stats.mtimeMs ).toString( 16 ) }"`,
				'Last-Modified': stats.mtime.toUTCString(),
				// Revalidate every time, so edits to theme and plugin files show on the next reload.
				'Cache-Control': 'no-cache',
			},
		};
	}
}

function getUrlPath( req: http.IncomingMessage ): string | null {
	if ( req.method !== 'GET' && req.method !== 'HEAD' ) {
		return null;
	}
	try {
		return decodeURIComponent( new URL( req.url ?? '/', 'http://localhost' ).pathname );
	} catch {
		return null;
	}
}
