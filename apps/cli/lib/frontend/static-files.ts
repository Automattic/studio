import fs from 'fs';
import path from 'path';
import { confineToRoot } from '@studio/common/lib/fs-utils';

const CONTENT_TYPES: Record< string, string > = {
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.cjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.xml': 'application/xml; charset=utf-8',
	'.csv': 'text/csv; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.ico': 'image/x-icon',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.pdf': 'application/pdf',
	'.wasm': 'application/wasm',
};

export function getContentType( filePath: string ): string {
	return CONTENT_TYPES[ path.extname( filePath ).toLowerCase() ] ?? 'application/octet-stream';
}

export type StaticResolution =
	| { type: 'file'; filePath: string }
	| { type: 'redirect'; location: string }
	| { type: 'not-found' };

function decodePathname( pathname: string ): string | undefined {
	try {
		const decoded = decodeURIComponent( pathname );
		return decoded.includes( '\0' ) ? undefined : decoded;
	} catch {
		return undefined;
	}
}

function statOrUndefined( filePath: string ): fs.Stats | undefined {
	try {
		return fs.statSync( filePath );
	} catch {
		return undefined;
	}
}

// Follows symlinks before the containment check, so a link can't serve files
// from outside the served folder.
function insideRealRoot( realRoot: string, filePath: string ): boolean {
	try {
		return confineToRoot( realRoot, fs.realpathSync( filePath ) ) !== null;
	} catch {
		return false;
	}
}

/**
 * Maps a request URL to a file under `realRoot`: `index.html` for `/` and
 * directories (redirecting `/dir` to `/dir/` so relative links resolve),
 * `<path>.html` for clean URLs, and nothing for anything outside the folder.
 * `realRoot` is the served folder's real path (`fs.realpathSync`), resolved
 * once when the server starts.
 */
export function resolveStaticRequest( realRoot: string, requestUrl: string ): StaticResolution {
	const url = new URL( requestUrl, 'http://localhost' );
	const pathname = decodePathname( url.pathname );
	if ( pathname === undefined ) {
		return { type: 'not-found' };
	}

	const target = confineToRoot( realRoot, '.' + path.posix.normalize( '/' + pathname ) );
	if ( ! target ) {
		return { type: 'not-found' };
	}

	const stats = statOrUndefined( target );
	if ( stats?.isDirectory() ) {
		if ( ! url.pathname.endsWith( '/' ) ) {
			return { type: 'redirect', location: `${ url.pathname }/${ url.search }` };
		}
		const indexPath = path.join( target, 'index.html' );
		if ( statOrUndefined( indexPath )?.isFile() && insideRealRoot( realRoot, indexPath ) ) {
			return { type: 'file', filePath: indexPath };
		}
		return { type: 'not-found' };
	}

	if ( stats?.isFile() && insideRealRoot( realRoot, target ) ) {
		return { type: 'file', filePath: target };
	}

	if ( ! path.extname( target ) ) {
		const htmlPath = `${ target }.html`;
		if ( statOrUndefined( htmlPath )?.isFile() && insideRealRoot( realRoot, htmlPath ) ) {
			return { type: 'file', filePath: htmlPath };
		}
	}

	return { type: 'not-found' };
}

export function getNotFoundPage( root: string ): string | undefined {
	const notFoundPath = path.join( path.resolve( root ), '404.html' );
	return statOrUndefined( notFoundPath )?.isFile() ? notFoundPath : undefined;
}
