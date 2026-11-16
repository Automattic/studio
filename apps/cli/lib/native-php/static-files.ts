import fs from 'fs';
import path from 'path';
import type http from 'http';

// PHP's built-in server sends static files without validators, so browsers download every script
// and stylesheet again on each page load, and each download waits for one of the few
// single-threaded PHP workers. PHP keeps serving them, and stays in charge of content types and of
// which paths are private: the proxy only adds validators to the files it served, and answers the
// browser's revalidation of an unchanged file itself.
export class StaticFileValidators {
	// URL paths PHP has served as static files. Only these are revalidated without PHP, so a path
	// PHP keeps private never gets a response from the proxy.
	private readonly servedPaths = new Set< string >();

	constructor( private readonly sitePath: string ) {}

	// Answers a revalidation of an unchanged static file with 304 and returns true, or returns
	// false to leave the request to PHP.
	answerRevalidation( req: http.IncomingMessage, res: http.ServerResponse ): boolean {
		const ifNoneMatch = req.headers[ 'if-none-match' ];
		const urlPath = getUrlPath( req );
		if ( ! ifNoneMatch || ! urlPath || ! this.servedPaths.has( urlPath ) ) {
			return false;
		}

		const validators = this.getValidators( urlPath );
		if (
			! validators ||
			! ifNoneMatch.split( ',' ).some( ( tag ) => tag.trim() === validators.ETag )
		) {
			return false;
		}

		res.writeHead( 304, validators );
		res.end();
		return true;
	}

	// Adds validators to PHP's successful response for an existing static file.
	addValidators(
		req: http.IncomingMessage,
		statusCode: number | undefined,
		headers: http.IncomingHttpHeaders
	): void {
		const urlPath = getUrlPath( req );
		const validators = statusCode === 200 && urlPath && this.getValidators( urlPath );
		if ( ! validators ) {
			return;
		}

		this.servedPaths.add( urlPath );
		headers.etag = validators.ETag;
		headers[ 'last-modified' ] = validators[ 'Last-Modified' ];
		headers[ 'cache-control' ] = validators[ 'Cache-Control' ];
	}

	private getValidators( urlPath: string ) {
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
			ETag: `W/"${ stats.size.toString( 16 ) }-${ Math.floor( stats.mtimeMs ).toString( 16 ) }"`,
			'Last-Modified': stats.mtime.toUTCString(),
			// Revalidate every time, so edits to theme and plugin files show on the next reload.
			'Cache-Control': 'no-cache',
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
