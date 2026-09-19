import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

// An empty data: URL is a *valid, zero-byte resource*: the browser loads it
// successfully, so a stylesheet that lost its asset still reports a clean load
// and the loss becomes invisible. about:blank cannot be fetched as a
// subresource, so the missing asset stays observable in devtools and in any
// parity check that inspects failed requests.
const UNAVAILABLE_CSS_URL = 'about:blank';
// Recognition is broader than emission. The legacy empty data: URL still arrives
// inside source stylesheets — producers inject it themselves, and earlier
// captures wrote it — so @font-face sentinel stripping must keep matching it
// even though nothing emits it any more.
const UNAVAILABLE_CSS_SENTINELS = [ UNAVAILABLE_CSS_URL, 'data:application/octet-stream;base64,' ];
const TRANSPARENT_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const TRANSPARENT_IMAGE_PAYLOAD = TRANSPARENT_IMAGE.slice( TRANSPARENT_IMAGE.indexOf( ',' ) + 1 );

/**
 * `rel` values that make a `<link>` fetch something. `canonical` and
 * `alternate` are metadata: they name a URL without requesting it, so a copy
 * that still points at its origin there is not reaching out to the network.
 */
export const ASSET_LINK_REL = /^(?:stylesheet|preload|prefetch|preconnect|dns-prefetch|prerender|modulepreload|manifest)$|(?:^|-)icon$/;

// `data:` and `blob:` URIs carry their bytes inline (or reference an in-memory
// object): there is nothing on the network to fetch, so neither is ever a
// dependency to resolve or an asset to strip as remote.
export function isInlineUrl( value: string ): boolean {
	const url = value.trim();
	return url.startsWith( 'data:' ) || url.startsWith( 'blob:' );
}

export function isRemoteAssetUrl( value: string ): boolean {
	const url = value.trim().replace( /&amp;/g, '&' );
	if ( ! url || isInlineUrl( url ) || url.startsWith( '#' ) ) {
		return false;
	}
	if ( ! /^(?:https?:)?\/\//i.test( url ) ) return false;
	try {
		const host = new URL( url.startsWith( '//' ) ? `https:${ url }` : url ).hostname.toLowerCase();
		return host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]';
	} catch {
		return false;
	}
}

// Browsers fetch a stylesheet's source map from wherever `sourceMappingURL`
// points once devtools is open. A map the capture never downloaded has no
// local replacement, so a leftover absolute reference is a live request back
// to the source CDN rather than an inert pointer — drop the comment entirely.
const SOURCE_MAPPING_COMMENT = /\/\*[#@]\s*sourceMappingURL=\s*([^\s*]+)\s*\*\//gi;

function isUnavailableCssAssetUrl( reference: string ): boolean {
	const url = reference.trim();
	return UNAVAILABLE_CSS_SENTINELS.some( ( sentinel ) => {
		if ( url === sentinel ) return true;
		if ( ! url.startsWith( sentinel ) ) return false;
		const rest = url.slice( sentinel.length );
		return rest.startsWith( '#' ) || rest.startsWith( '?' );
	} );
}

function splitTopLevel( value: string, separator: string ): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let quote = '';
	for ( const char of value ) {
		if ( quote ) {
			current += char;
			if ( char === quote ) quote = '';
			continue;
		}
		if ( char === '"' || char === "'" ) {
			quote = char;
			current += char;
			continue;
		}
		if ( char === '(' ) depth += 1;
		else if ( char === ')' ) depth -= 1;
		else if ( char === separator && depth === 0 ) {
			parts.push( current );
			current = '';
			continue;
		}
		current += char;
	}
	parts.push( current );
	return parts;
}

function omitEmptyFontFaceSrc( css: string ): string {
	return css.replace( /(@font-face\s*\{)([^{}]*)\}/gi, ( _block, open: string, body: string ) => {
		const declarations = splitTopLevel( body, ';' )
			.map( ( declaration ) => {
				const prefix = /^\s*src\s*:\s*/i.exec( declaration );
				if ( ! prefix ) return declaration;
				const kept = splitTopLevel( declaration.slice( prefix[ 0 ].length ), ',' ).filter( ( part ) => {
					if ( ! part.trim() ) return false;
					const urlMatch = /url\(\s*(?:["']([^"']*)["']|([^)]+))\s*\)/i.exec( part );
					if ( ! urlMatch ) return true;
					return ! isUnavailableCssAssetUrl( ( urlMatch[ 1 ] ?? urlMatch[ 2 ] ?? '' ).trim() );
				} );
				return kept.length === 0 ? '' : `${ prefix[ 0 ] }${ kept.join( ',' ) }`;
			} )
			.filter( ( declaration ) => declaration.trim() !== '' );
		return `${ open }${ declarations.join( ';' ) }}`;
	} );
}

export function stripRemoteCssUrls( css: string ): string {
	return omitEmptyFontFaceSrc(
		css
			.replace( SOURCE_MAPPING_COMMENT, ( match, reference ) =>
				isRemoteAssetUrl( reference ) ? '' : match
			)
			.replace( /url\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)/gi, ( match, quoted, bare ) => {
				const reference = quoted ?? bare;
				return reference && isRemoteAssetUrl( reference ) ? `url("${ UNAVAILABLE_CSS_URL }")` : match;
			} )
			.replace( /@import\s+(?:url\(\s*)?["']([^"']+)["'][^;]*;?/gi, ( match, reference ) =>
				isRemoteAssetUrl( reference ) ? `@import "${ UNAVAILABLE_CSS_URL }";` : match
			)
	);
}

const PLACEHOLDER_SRCSET_CANDIDATE =
	/data:image\/gif;base64,\s*[A-Za-z0-9+/=]+\s+\d+[wx]\b/i;

function srcsetCandidates( srcset: string ): string[] {
	const candidates: string[] = [];
	const descriptor = /(?:^|,\s*)([\s\S]*?)\s+(\d+(?:\.\d+)?[wx])(?=\s*(?:,|$))/g;
	for ( const match of srcset.matchAll( descriptor ) ) {
		const url = match[ 1 ].trim().replace( /\s/g, ( whitespace ) => encodeURIComponent( whitespace ) );
		if ( url ) candidates.push( `${ url } ${ match[ 2 ] }` );
	}
	return candidates.length > 0 ? candidates : srcset.split( ',' ).map( ( candidate ) => candidate.trim() );
}

function withoutRemoteSrcset( srcset: string ): string {
	return srcsetCandidates( srcset )
		.filter( ( candidate ) => {
			const url = candidate.split( /\s+/ )[ 0 ] ?? '';
			return (
				url &&
				! PLACEHOLDER_SRCSET_CANDIDATE.test( candidate ) &&
				url !== TRANSPARENT_IMAGE_PAYLOAD &&
				! url.startsWith( 'data:' ) &&
				! isRemoteAssetUrl( url )
			);
		} )
		.join( ', ' );
}

export function stripRemoteAssetRequests( html: string ): string {
	const $ = cheerio.load( html );
	$( 'link[href]' ).each( ( _, element ) => {
		const node = $( element );
		const href = node.attr( 'href' ) ?? '';
		const rels = ( node.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
		if ( isRemoteAssetUrl( href ) && rels.some( ( rel ) => ASSET_LINK_REL.test( rel ) ) ) {
			node.remove();
		}
	} );
	$( 'img[src],source[src],video[src],audio[src],video[poster]' ).each( ( _, element ) => {
		const node = $( element );
		const tag = ( 'tagName' in element ? element.tagName : '' ).toLowerCase();
		for ( const attribute of [ 'src', 'poster' ] ) {
			const value = node.attr( attribute );
			if ( ! value || ! isRemoteAssetUrl( value ) ) continue;
			if ( tag === 'img' && attribute === 'src' ) node.attr( 'src', TRANSPARENT_IMAGE );
			else node.removeAttr( attribute );
		}
	} );
	$( '[srcset]' ).each( ( _, element ) => {
		const node = $( element );
		const kept = withoutRemoteSrcset( node.attr( 'srcset' ) ?? '' );
		if ( kept ) node.attr( 'srcset', kept );
		else node.removeAttr( 'srcset' );
	} );
	$( 'img' ).each( ( _, element ) => {
		const node = $( element );
		const src = node.attr( 'src' ) ?? '';
		if ( ! src.startsWith( 'data:' ) ) return;
		const fallback = ( node.attr( 'srcset' ) ?? '' ).trim().split( /\s+/ )[ 0 ];
		if ( fallback && ! fallback.startsWith( 'data:' ) ) node.attr( 'src', fallback );
	} );
	$( 'style' ).each( ( _, element ) => {
		const node = $( element );
		node.html( stripRemoteCssUrls( node.html() ?? '' ) );
	} );
	// `data-url` / `data-href` don't drive a fetch, but platforms (Wix's
	// stylesheet loader among them) use them to record where a `<style>` was
	// sourced from. Left in place they ship the source's internal CDN
	// topology in an otherwise self-contained artifact.
	$( '[data-url],[data-href]' ).each( ( _, element ) => {
		const node = $( element );
		for ( const attribute of [ 'data-url', 'data-href' ] ) {
			const value = node.attr( attribute );
			if ( value && isRemoteAssetUrl( value ) ) node.removeAttr( attribute );
		}
	} );
	$( '[style]' ).each( ( _, element ) => {
		const node = $( element );
		node.attr( 'style', stripRemoteCssUrls( node.attr( 'style' ) ?? '' ) );
	} );
	return $.html();
}

export function selfContainWebsite( websiteDir: string ): void {
	const visit = ( directory: string ): void => {
		for ( const name of readdirSync( directory ) ) {
			const path = join( directory, name );
			if ( statSync( path ).isDirectory() ) {
				visit( path );
				continue;
			}
			if ( name.endsWith( '.html' ) ) {
				writeFileSync( path, stripRemoteAssetRequests( readFileSync( path, 'utf8' ) ) );
			} else if ( name.endsWith( '.css' ) ) {
				writeFileSync( path, stripRemoteCssUrls( readFileSync( path, 'utf8' ) ) );
			}
		}
	};
	visit( websiteDir );
}
