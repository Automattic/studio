import { writeFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { BASE_URL, DOCS_URL, MANIFEST_PATH, USER_AGENT, slugify } from './lib/common.mjs';

// This mirror only tracks the WordPress Studio docs.
const STUDIO_SECTION = 'wordpress-studio';
const STUDIO_URL = `${ DOCS_URL }developer-tools/studio/`;
const SITEMAP_URL = `${ BASE_URL }/sitemap-1.xml`;

function filePathFor( url, hasChildren ) {
	const { pathname } = new URL( url );
	const segments = pathname
		.replace( /^\/docs\//, '' )
		.replace( /\/$/, '' )
		.split( '/' )
		.filter( Boolean );
	if ( hasChildren ) {
		return `docs/${ segments.join( '/' ) }/index.md`;
	}
	const leaf = segments[ segments.length - 1 ];
	const dirSegments = segments.slice( 0, -1 );
	return dirSegments.length
		? `docs/${ dirSegments.join( '/' ) }/${ leaf }.md`
		: `docs/${ leaf }.md`;
}

function walk( $, ul, section, sectionLabel, depth, entries ) {
	ul.children( 'li' ).each( ( _, liEl ) => {
		const li = $( liEl );
		const a = li.children( 'a' ).first();
		const title = a.text().trim();
		const url = a.attr( 'href' );
		const subUl = li.children( 'ul' ).first();
		const hasChildren = subUl.length > 0;

		entries.push( {
			section,
			sectionLabel,
			title,
			url,
			depth,
			filePath: filePathFor( url, hasChildren ),
		} );

		if ( hasChildren ) {
			walk( $, subUl, section, sectionLabel, depth + 1, entries );
		}
	} );
}

async function fetchHtml( url, init = {} ) {
	return fetch( url, { headers: { 'User-Agent': USER_AGENT }, ...init } );
}

// Some published Studio pages are linked from body copy but not from the
// sidebar nav (e.g. php-runtimes/). Pick them up from the sitemap, keeping only
// URLs that render the docs template and are their own canonical.
async function findUnlistedStudioPages( entries ) {
	const res = await fetchHtml( SITEMAP_URL );
	if ( ! res.ok ) {
		throw new Error( `Failed to fetch ${ SITEMAP_URL }: HTTP ${ res.status }` );
	}
	const xml = await res.text();
	const known = new Set( entries.map( ( e ) => e.url ) );
	const candidates = [ ...xml.matchAll( /<loc>([^<]+)<\/loc>/g ) ]
		.map( ( m ) => m[ 1 ].trim() )
		.filter( ( url ) => url.startsWith( STUDIO_URL ) && ! known.has( url ) );

	const found = [];
	for ( const url of candidates ) {
		const pageRes = await fetchHtml( url, { redirect: 'manual' } );
		if ( pageRes.status !== 200 ) continue;
		const $ = cheerio.load( await pageRes.text() );
		const canonical = $( 'link[rel="canonical"]' ).attr( 'href' );
		if ( canonical && canonical !== url ) continue;
		if ( $( '.a8c-docs-entry__content' ).length === 0 ) continue;
		const title = $( 'h1' ).first().text().trim() || $( 'title' ).text().split( '|' )[ 0 ].trim();
		found.push( { url, title } );
	}
	return found;
}

function insertUnlisted( entries, pages ) {
	for ( const { url, title } of pages ) {
		// Nest under the closest ancestor entry, after its last descendant.
		const parentUrl = url.replace( /[^/]+\/$/, '' );
		const parentIdx = entries.findIndex( ( e ) => e.url === parentUrl );
		const parent = entries[ parentIdx ];
		let insertAt = parentIdx + 1;
		while ( insertAt < entries.length && entries[ insertAt ].url.startsWith( parentUrl ) ) {
			insertAt++;
		}
		entries.splice( insertAt, 0, {
			section: parent.section,
			sectionLabel: parent.sectionLabel,
			title,
			url,
			depth: parent.depth + 1,
			filePath: filePathFor( url, false ),
		} );
	}
}

async function main() {
	console.log( `Fetching ${ DOCS_URL } ...` );
	const res = await fetch( DOCS_URL, { headers: { 'User-Agent': USER_AGENT } } );
	if ( ! res.ok ) {
		throw new Error( `Failed to fetch ${ DOCS_URL }: HTTP ${ res.status }` );
	}
	const html = await res.text();
	const $ = cheerio.load( html );

	const nav = $( 'nav[aria-label="Main Menu"].a8c-docs-layout__sidebar__desktop' );
	if ( nav.length === 0 ) {
		throw new Error(
			'Could not find the main nav on the docs homepage — site markup may have changed.'
		);
	}
	const topUl = nav.find( 'ul.a8c-docs-sidebar-list' ).first();

	const entries = [];
	topUl.children( 'li' ).each( ( _, liEl ) => {
		const li = $( liEl );
		const a = li.children( 'a' ).first();
		const sectionLabel = a.text().trim();
		const section = slugify( sectionLabel );
		const url = a.attr( 'href' );
		const subUl = li.children( 'ul' ).first();
		const hasChildren = subUl.length > 0;

		entries.push( {
			section,
			sectionLabel,
			title: sectionLabel,
			url,
			depth: 0,
			filePath: filePathFor( url, hasChildren ),
		} );

		if ( hasChildren ) {
			walk( $, subUl, section, sectionLabel, 1, entries );
		}
	} );

	const studioEntries = entries.filter( ( e ) => e.section === STUDIO_SECTION );
	if ( studioEntries.length === 0 ) {
		throw new Error(
			`No "${ STUDIO_SECTION }" section found in the nav — site markup may have changed.`
		);
	}

	const unlisted = await findUnlistedStudioPages( studioEntries );
	insertUnlisted( studioEntries, unlisted );
	for ( const { url } of unlisted ) {
		console.log( `  + ${ url } (from sitemap, not in sidebar nav)` );
	}

	await writeFile( MANIFEST_PATH, JSON.stringify( studioEntries, null, 2 ) + '\n', 'utf8' );

	const bySection = new Map();
	for ( const e of studioEntries ) {
		bySection.set( e.section, ( bySection.get( e.section ) || 0 ) + 1 );
	}

	console.log( `\nWrote ${ studioEntries.length } entries to manifest.json\n` );
	console.log( 'slug'.padEnd( 24 ) + 'label'.padEnd( 28 ) + 'pages' );
	console.log( '-'.repeat( 60 ) );
	for ( const [ section, count ] of bySection ) {
		const label = studioEntries.find( ( e ) => e.section === section ).sectionLabel;
		console.log( section.padEnd( 24 ) + label.padEnd( 28 ) + count );
	}
	console.log( `\nRun a section with: node scripts/fetch-section.mjs --section <slug>` );
}

main().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
