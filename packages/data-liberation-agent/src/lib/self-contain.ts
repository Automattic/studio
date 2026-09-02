import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';

const EMPTY_CSS_URL = 'data:application/octet-stream;base64,';
const TRANSPARENT_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

/**
 * `rel` values that make a `<link>` fetch something. `canonical` and
 * `alternate` are metadata: they name a URL without requesting it, so a copy
 * that still points at its origin there is not reaching out to the network.
 */
export const ASSET_LINK_REL = /^(?:stylesheet|preload|prefetch|preconnect|dns-prefetch|prerender|modulepreload|manifest)$|(?:^|-)icon$/;

export function isRemoteAssetUrl( value: string ): boolean {
	const url = value.trim().replace( /&amp;/g, '&' );
	if ( ! url || url.startsWith( 'data:' ) || url.startsWith( 'blob:' ) || url.startsWith( '#' ) ) {
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

export function stripRemoteCssUrls( css: string ): string {
	return css
		.replace( /url\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)/gi, ( match, quoted, bare ) => {
			const reference = quoted ?? bare;
			return reference && isRemoteAssetUrl( reference ) ? `url("${ EMPTY_CSS_URL }")` : match;
		} )
		.replace( /@import\s+(?:url\(\s*)?["']([^"']+)["'][^;]*;?/gi, ( match, reference ) =>
			isRemoteAssetUrl( reference ) ? `@import "${ EMPTY_CSS_URL }";` : match
		);
}

const PLACEHOLDER_SRCSET_CANDIDATE =
	/data:image\/gif;base64,\s*[A-Za-z0-9+/=]+\s+\d+[wx]\b/i;

function srcsetCandidates( srcset: string ): string[] {
	const candidates: string[] = [];
	const descriptor = /(?:^|,\s*)([\s\S]*?)\s+(\d+(?:\.\d+)?[wx])(?=\s*(?:,|$))/g;
	for ( const match of srcset.matchAll( descriptor ) ) {
		const url = match[ 1 ].trim();
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
