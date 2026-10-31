/**
 * The text of a site's own HTML pages that the site, once it shows some of
 * it, shows nowhere: what a move of a hand-written site onto WordPress left
 * behind. The HTML documents in the site's folder, outside WordPress's own
 * (wp-admin, wp-includes, wp-content), are the pages being moved; the site is
 * its front page and the pages it links to, as a visitor gets them. Text a
 * site shows none of is a folder not being moved, and says nothing.
 *
 * In the html-site-move eval case, the old pages' shared footer, "Teaching
 * sailors since 1998", stayed behind the theme's own footer.
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { render } from '@studio/agent/node/page-render';
import type { StudioAgentHost } from '@studio/agent/node/host';

// WordPress's own folders, and readme.html, which WordPress ships at the root.
const NOT_THE_SITES = new Set( [ 'wp-admin', 'wp-includes', 'wp-content', 'node_modules' ] );
const DEPTH = 3;
const MAX_DOCUMENTS = 50;
const MAX_PAGES = 30;
const SHOWN = 10;
// A run of fewer words is a label (a menu item, a button), which a move renames.
const MIN_WORDS = 3;

async function htmlDocuments( dir: string, depth = 0 ): Promise< string[] > {
	const entries = await readdir( dir, { withFileTypes: true } ).catch( () => [] );
	const found = await Promise.all(
		entries.map( async ( entry ) => {
			const at = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				return depth < DEPTH && ! entry.name.startsWith( '.' ) && ! NOT_THE_SITES.has( entry.name )
					? htmlDocuments( at, depth + 1 )
					: [];
			}
			return entry.isFile() &&
				/\.html?$/i.test( entry.name ) &&
				! ( depth === 0 && entry.name === 'readme.html' )
				? [ at ]
				: [];
		} )
	);
	return found.flat().sort();
}

// Text as its words, the same however a page spaces, punctuates or texturizes it.
function words( text: string ): string {
	const decoded = text
		.replace( /&#x([0-9a-f]+);/gi, ( _, hex ) => String.fromCodePoint( parseInt( hex, 16 ) ) )
		.replace( /&#(\d+);/g, ( _, code ) => String.fromCodePoint( Number( code ) ) )
		.replace( /&[a-z]+;/gi, ' ' );
	return ( decoded.toLowerCase().match( /[\p{L}\p{N}]+/gu ) ?? [] ).join( ' ' );
}

// What a document shows: its body without scripts, styles and markup.
function visible( html: string ): string {
	return ( html.match( /<body\b[^>]*>([\s\S]*)<\/body>/i )?.[ 1 ] ?? html )
		.replace( /<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ' )
		.replace( /<!--[\s\S]*?-->/g, ' ' );
}

// A shortcode's opening or closing tag, which WordPress replaces with what its
// callback returns (do_shortcode() and get_shortcode_regex() in wp-includes/shortcodes.php).
const SHORTCODE_TAG = /\[\/?[^<>&/[\]\s=]+(?:[\s/][^\]]*)?\]/g;

// A document's runs of text, each between two tags: a heading, a paragraph, a
// footer line. A page's own markup, as an agent writes it to save as a post,
// can hold shortcodes, whose tags are not text WordPress shows.
function runs( html: string ): Array< { text: string; words: string } > {
	return visible( html )
		.split( /<[^>]*>/ )
		.map( ( text ) => text.replace( SHORTCODE_TAG, ' ' ).replace( /\s+/g, ' ' ).trim() )
		.map( ( text ) => ( { text, words: words( text ) } ) )
		.filter( ( run ) => run.words.split( ' ' ).length >= MIN_WORDS );
}

// The site's front page and the pages it links to, as one text of words.
async function siteText( url: string ): Promise< string | undefined > {
	const home = await render( `${ url }/` );
	if ( ! home ) {
		return undefined;
	}
	const origin = new URL( url ).origin;
	const links = [
		...new Set(
			[ ...home.matchAll( /<a\b[^>]*\bhref="([^"#]*)/g ) ]
				.map( ( match ) => {
					try {
						return new URL( match[ 1 ].replace( /&amp;/g, '&' ), `${ url }/` );
					} catch {
						return undefined;
					}
				} )
				.filter(
					( link ): link is URL =>
						!! link &&
						link.origin === origin &&
						! /\/(wp-admin|wp-login|feed)\b/.test( link.pathname )
				)
				.map( ( link ) => link.href )
		),
	].slice( 0, MAX_PAGES );
	const pages = await Promise.all( links.map( render ) );
	return ` ${ [ home, ...pages ]
		.map( ( page ) => words( visible( page ?? '' ).replace( /<[^>]*>/g, ' ' ) ) )
		.join( ' | ' ) } `;
}

/** The text of the site's own HTML pages it shows nowhere, once it shows some of it. */
export async function missingSourceText(
	host: StudioAgentHost,
	sitePath: string
): Promise< string | undefined > {
	const documents = ( await htmlDocuments( sitePath ) ).slice( 0, MAX_DOCUMENTS );
	if ( ! documents.length ) {
		return undefined;
	}
	const site = await host.sites.findByFolder( sitePath );
	const shown = site && ( await siteText( site.url.replace( /\/$/, '' ) ) );
	if ( ! shown ) {
		return undefined;
	}
	// Each run once, with the documents it is in.
	const byWords = new Map< string, { text: string; files: string[] } >();
	for ( const document of documents ) {
		const file = path.relative( sitePath, document ).split( path.sep ).join( '/' );
		for ( const run of runs( await readFile( document, 'utf8' ).catch( () => '' ) ) ) {
			const entry = byWords.get( run.words ) ?? { text: run.text, files: [] };
			entry.files = [ ...new Set( [ ...entry.files, file ] ) ];
			byWords.set( run.words, entry );
		}
	}
	const all = [ ...byWords ];
	const missing = all.filter( ( [ key ] ) => ! shown.includes( ` ${ key } ` ) );
	if ( ! missing.length || missing.length === all.length ) {
		return undefined;
	}
	const listed = missing
		.slice( 0, SHOWN )
		.map( ( [ , { text, files } ] ) => `"${ text }" (${ files.join( ', ' ) })` );
	const more = missing.length > SHOWN ? `, and ${ missing.length - SHOWN } more` : '';
	return `${ site.url.replace( /\/$/, '' ) } shows ${ all.length - missing.length } of the ${
		all.length
	} runs of text in the HTML pages in its folder, and none of its front page and the pages it links to, as a visitor gets them, show: ${ listed.join(
		'; '
	) }${ more }. Text in every one of those pages, as a header or footer is, goes in the site's header or footer template part; the rest on the page it was on.`;
}
