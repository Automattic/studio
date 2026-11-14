import fs from 'fs';
import path from 'path';
import type http from 'http';

// Static files are served here, before a request reaches a PHP worker. PHP's built-in server
// sends them without validators, so browsers download every script and stylesheet again on
// each page load, and each of those requests waits for one of the few single-threaded workers.

const CONTENT_TYPES: Record< string, string > = {
	avif: 'image/avif',
	css: 'text/css; charset=utf-8',
	eot: 'application/vnd.ms-fontobject',
	gif: 'image/gif',
	htm: 'text/html; charset=utf-8',
	html: 'text/html; charset=utf-8',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	js: 'text/javascript; charset=utf-8',
	json: 'application/json',
	map: 'application/json',
	mjs: 'text/javascript; charset=utf-8',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	otf: 'font/otf',
	pdf: 'application/pdf',
	png: 'image/png',
	svg: 'image/svg+xml',
	ttf: 'font/ttf',
	txt: 'text/plain; charset=utf-8',
	wasm: 'application/wasm',
	webm: 'video/webm',
	webp: 'image/webp',
	woff: 'font/woff',
	woff2: 'font/woff2',
	xml: 'application/xml',
};

// Mirrors router.php: dotfiles (except .well-known) and the SQLite database directory stay
// private, and phpMyAdmin is mapped by the router, so all of these are left to PHP.
const PRIVATE_PATH = /\/\.(?!well-known(\/|$))|^\/wp-content\/database(\/|$)|^\/phpmyadmin(\/|$)/;

function getStaticFilePath( sitePath: string, req: http.IncomingMessage ): string | null {
	// Range requests (media seeking) keep PHP's built-in handling.
	if ( ( req.method !== 'GET' && req.method !== 'HEAD' ) || req.headers.range ) {
		return null;
	}

	let urlPath: string;
	try {
		urlPath = decodeURIComponent( new URL( req.url ?? '/', 'http://localhost' ).pathname );
	} catch {
		return null;
	}

	const normalizedPath = urlPath.replace( /[/\\]+/g, '/' ).toLowerCase();
	if ( PRIVATE_PATH.test( normalizedPath ) || normalizedPath.endsWith( '.php' ) ) {
		return null;
	}

	const filePath = path.join( sitePath, urlPath );
	if ( ! filePath.startsWith( path.join( sitePath, path.sep ) ) ) {
		return null;
	}

	return filePath;
}

// Serves an existing static file under the site root and returns true, or returns false to
// leave the request to PHP (scripts, missing paths, private paths).
export function serveStaticFile(
	sitePath: string,
	req: http.IncomingMessage,
	res: http.ServerResponse
): boolean {
	const filePath = getStaticFilePath( sitePath, req );
	if ( ! filePath ) {
		return false;
	}

	let stats: fs.Stats;
	try {
		stats = fs.statSync( filePath );
	} catch {
		return false;
	}
	if ( ! stats.isFile() ) {
		return false;
	}

	const lastModified = stats.mtime.toUTCString();
	const etag = `W/"${ stats.size.toString( 16 ) }-${ Math.floor( stats.mtimeMs ).toString( 16 ) }"`;
	const extension = path.extname( filePath ).slice( 1 ).toLowerCase();
	const headers = {
		'Content-Type': CONTENT_TYPES[ extension ] ?? 'application/octet-stream',
		'Last-Modified': lastModified,
		ETag: etag,
		// Revalidate every time, so edits to theme and plugin files show on the next reload.
		'Cache-Control': 'no-cache',
	};

	const ifNoneMatch = req.headers[ 'if-none-match' ];
	const isNotModified = ifNoneMatch
		? ifNoneMatch.split( ',' ).some( ( tag ) => tag.trim() === etag )
		: req.headers[ 'if-modified-since' ] === lastModified;
	if ( isNotModified ) {
		res.writeHead( 304, headers );
		res.end();
		return true;
	}

	res.writeHead( 200, { ...headers, 'Content-Length': stats.size } );
	if ( req.method === 'HEAD' ) {
		res.end();
		return true;
	}

	fs.createReadStream( filePath )
		.on( 'error', () => res.destroy() )
		.pipe( res );
	return true;
}
