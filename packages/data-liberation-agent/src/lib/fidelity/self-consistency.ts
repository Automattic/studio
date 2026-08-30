// src/lib/fidelity/self-consistency.ts
//
// Does the copy work on its own terms?
//
// Most of what a liberated site can get wrong is answerable without the live
// source and without a browser: an anchor with no target, a link to a page that
// was never written, an asset still pointing at the origin CDN. Those are the
// failures a reader actually hits, they are pure functions of what is on disk,
// and checking them costs milliseconds — so every route gets checked, not a
// sample.
//
// Comparing against the live source is a different and far more expensive
// question, and it lives in check.ts.
//
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { ASSET_LINK_REL, isRemoteAssetUrl } from '../self-contain.js';
import { resolveRequestPath } from '../replicate/local-site/static-server.js';

export type FindingKind = 'anchor-missing' | 'anchor-ambiguous' | 'link-dangling' | 'remote-asset';

export interface Finding {
	route: string;
	kind: FindingKind;
	detail: string;
}

export interface SelfConsistencyReport {
	/** Routes examined. Always all of them. */
	routes: number;
	findings: Finding[];
	pass: boolean;
}

/** Asset references that must resolve inside the copy for it to stand alone. */
const ASSET_REFS: Array< [ string, string ] > = [
	[ 'img[src]', 'src' ],
	[ 'source[src]', 'src' ],
	[ 'video[src]', 'src' ],
	[ 'audio[src]', 'src' ],
	[ 'script[src]', 'src' ],
	[ 'link[href]', 'href' ],
];

/**
 * Count elements a fragment would resolve to in a document.
 *
 * Cached by file, because a shared nav means the same target page is asked
 * about once per route otherwise.
 */
function fragmentTargets(
	cache: Map< string, cheerio.CheerioAPI | null >,
	file: string,
	fragment: string
): number | null {
	let $ = cache.get( file );
	if ( $ === undefined ) {
		try {
			$ = cheerio.load( readFileSync( file, 'utf8' ) );
		} catch {
			$ = null;
		}
		cache.set( file, $ );
	}
	if ( ! $ ) return null;
	return $( '[id],a[name]' ).filter(
		( _index, target ) =>
			$!( target ).attr( 'id' ) === fragment || $!( target ).attr( 'name' ) === fragment
	).length;
}

/**
 * Check every route in the copy for defects visible without the source.
 *
 * `resolveRequestPath` is the same resolver the local preview server uses, so a
 * link this reports as dangling is one that would genuinely 404 when someone
 * clicked it.
 */
export function checkSelfConsistency(
	websiteDir: string,
	routeFiles: Map< string, string >
): SelfConsistencyReport {
	const findings: Finding[] = [];
	const documents = new Map< string, cheerio.CheerioAPI | null >();

	for ( const [ route, relative ] of routeFiles ) {
		let html: string;
		try {
			html = readFileSync( join( websiteDir, relative ), 'utf8' );
		} catch {
			findings.push( { route, kind: 'link-dangling', detail: `route file missing: ${ relative }` } );
			continue;
		}
		const $ = cheerio.load( html );

		const seen = new Set< string >();
		$( 'a[href]' ).each( ( _index, element ) => {
			const href = ( $( element ).attr( 'href' ) ?? '' ).trim();
			if ( ! href || href === '#' ) return;
			if ( /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test( href ) ) return; // external or non-http scheme
			if ( seen.has( href ) ) return;
			seen.add( href );

			const [ rawPath = '', rawFragment = '' ] = href.split( '#' );
			// The export rewrites same-page links to `/index.html#fragment`, so a
			// link is same-document by where it resolves, not by how it is spelled.
			const target = rawPath
				? resolveRequestPath( websiteDir, rawPath.startsWith( '/' ) ? rawPath : `/${ join( relative, '..', rawPath ) }` )
				: join( websiteDir, relative );
			if ( ! target ) {
				findings.push( { route, kind: 'link-dangling', detail: href } );
				return;
			}
			if ( ! rawFragment ) return;

			let fragment: string;
			try {
				fragment = decodeURIComponent( rawFragment );
			} catch {
				return;
			}
			if ( ! fragment ) return;

			const targets = fragmentTargets( documents, target, fragment );
			if ( targets === null ) return;
			if ( targets === 0 ) {
				findings.push( { route, kind: 'anchor-missing', detail: href } );
			} else if ( targets > 1 ) {
				// Two targets and the browser silently picks the first, which is how
				// a mobile anchor ends up scrolling to a hidden desktop section.
				findings.push( {
					route,
					kind: 'anchor-ambiguous',
					detail: `${ href } matches ${ targets } targets`,
				} );
			}
		} );

		const seenRemote = new Set< string >();
		for ( const [ selector, attribute ] of ASSET_REFS ) {
			$( selector ).each( ( _index, element ) => {
				const node = $( element );
				// A <link> only counts when its rel actually fetches something.
				if ( selector.startsWith( 'link' ) ) {
					const relations = ( node.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
					if ( ! relations.some( ( relation ) => ASSET_LINK_REL.test( relation ) ) ) return;
				}
				const value = ( node.attr( attribute ) ?? '' ).trim();
				if ( ! value || ! isRemoteAssetUrl( value ) ) return;
				let host: string;
				try {
					host = new URL( value.startsWith( '//' ) ? `https:${ value }` : value ).hostname;
				} catch {
					return;
				}
				if ( seenRemote.has( host ) ) return;
				seenRemote.add( host );
				findings.push( { route, kind: 'remote-asset', detail: host } );
			} );
		}
	}

	return { routes: routeFiles.size, findings, pass: findings.length === 0 };
}

/** Group findings for reporting, so one broken template does not print 60 times. */
export function summariseFindings( findings: Finding[] ): Array< { kind: FindingKind; routes: number; examples: string[] } > {
	const byKind = new Map< FindingKind, { routes: Set< string >; examples: string[] } >();
	for ( const finding of findings ) {
		const entry = byKind.get( finding.kind ) ?? { routes: new Set< string >(), examples: [] };
		entry.routes.add( finding.route );
		if ( entry.examples.length < 3 ) entry.examples.push( `${ finding.route } ${ finding.detail }` );
		byKind.set( finding.kind, entry );
	}
	return [ ...byKind ].map( ( [ kind, entry ] ) => ( {
		kind,
		routes: entry.routes.size,
		examples: entry.examples,
	} ) );
}
