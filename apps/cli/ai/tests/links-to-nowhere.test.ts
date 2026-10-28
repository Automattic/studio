import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { linksToNowhereChanges } from 'cli/ai/links-to-nowhere';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteUrl: ( site: { port: number } ) => `http://localhost:${ site.port }`,
	findSiteByFolder: async ( folder: string ) => ( folder === site.path ? site : undefined ),
} ) );
vi.mock( 'cli/ai/block-render-check', () => ( {
	readRenderedVersions: async () => ( { 'post:2': 'a' } ),
} ) );

const site = { id: '1', name: 'Groomer', path: '/sites/groomer', port: 8881 } as SiteData;
// The footer Twenty Twenty-Five renders, as WordPress 7.1 serves it.
const STOCK_FOOTER = readFileSync(
	path.join( import.meta.dirname, 'fixtures', 'twentytwentyfive-footer.html' ),
	'utf8'
);
const check = ( before: Record< string, string >, after: Record< string, string > ) =>
	linksToNowhereChanges.check( site, before, after );
const problem = async () =>
	( await check( { 'post:2': 'a' }, { 'post:2': 'b' } ) ).reports[ 0 ]?.problem;

afterEach( () => vi.unstubAllGlobals() );

// The home page WordPress renders, as the site's server would.
function serve( html: string | undefined ) {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) => {
			if ( url !== 'http://localhost:8881/' || html === undefined ) {
				throw new TypeError( 'fetch failed' );
			}
			return new Response( html );
		} )
	);
}

const header = ( links: string ) =>
	`<header class="wp-block-template-part"><nav><a href="/">Home</a>${ links }</nav></header>`;
const footer = ( links: string ) =>
	`<footer class="wp-block-template-part"><div><a href="https://wordpress.org">WordPress</a>${ links }</div></footer>`;
const nav = ( label: string ) =>
	`<a class="wp-block-navigation-item__content" href="#"><span class="wp-block-navigation-item__label">${ label }</span></a>`;

it.each< { name: string; html: string | undefined; links?: string } >( [
	{
		name: 'placeholder links in a template part and the content',
		html:
			header( '' ) +
			'<main><a class="wp-block-button__link" href="#">Book now</a><a href="#services">Services</a></main>' +
			footer(
				nav( 'Blog' ) + nav( 'FAQ&#039;s &amp; tips' ) + '<a href="#"><img src="x.png"></a>'
			),
		links:
			'"Book now" in the page\'s content; "Blog", "FAQ\'s & tips", one with no text in the footer template part',
	},
	{
		name: "Twenty Twenty-Five's footer",
		html: header( '' ) + STOCK_FOOTER,
		links:
			'"Blog", "About", "FAQs", "Authors", "Events", "Shop", "Patterns", "Themes" in the footer template part',
	},
	{
		name: 'links to pages and sections',
		html: header( '<a href="/#services">Services</a>' ) + footer( '<a href="/about/">About</a>' ),
	},
	{ name: 'a site whose server is not running', html: undefined },
] )( '$name', async ( { html, links } ) => {
	serve( html );
	if ( links ) {
		expect( await problem() ).toBe(
			`On http://localhost:8881/, the links ${ links } go nowhere: their href is only "#", an empty fragment, which takes a visitor to the top of the page they are on (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php). Link each to the page or section it names, or take it out.`
		);
	} else {
		expect( await problem() ).toBeUndefined();
	}
} );

it( 'renders the site only when a call changed what it renders, and raises the problem at turn end', async () => {
	serve( header( nav( 'Shop' ) ) );
	expect( await check( { 'post:2': 'a' }, { 'post:2': 'a' } ) ).toEqual( { reports: [] } );
	expect( fetch ).not.toHaveBeenCalled();
	expect( ( await check( { 'post:2': 'a' }, { 'post:2': 'b' } ) ).reports ).toEqual( [
		{ key: 'links to nowhere', problem: expect.stringContaining( '"Shop"' ), atTurnEnd: true },
	] );
} );

it.each< {
	name: string;
	first: string | undefined;
	sitePath: string;
	reported: string | undefined;
} >( [
	{
		name: 'the links the site had as Studio first saw it, and raises one added since',
		first: header( nav( 'Shop' ) ) + STOCK_FOOTER,
		sitePath: site.path,
		reported: '"Book" in the header template part',
	},
	{
		name: 'nothing, when the site was not running as Studio first saw it',
		first: undefined,
		sitePath: site.path,
		reported:
			'"Shop", "Book" in the header template part; "Blog", "About", "FAQs", "Authors", "Events", "Shop", "Patterns", "Themes" in the footer template part',
	},
	{
		name: 'nothing, for a folder that is not a Studio site',
		first: header( nav( 'Shop' ) ) + STOCK_FOOTER,
		sitePath: '/sites/elsewhere',
		reported:
			'"Shop", "Book" in the header template part; "Blog", "About", "FAQs", "Authors", "Events", "Shop", "Patterns", "Themes" in the footer template part',
	},
] )( 'keeps $name', async ( { first, sitePath, reported } ) => {
	serve( first );
	const seen = await linksToNowhereChanges.read( sitePath );
	serve( header( nav( 'Shop' ) + nav( 'Book' ) ) + STOCK_FOOTER );
	// A later read keeps what was first seen, without rendering the site.
	const later = await linksToNowhereChanges.read( sitePath, seen );
	expect( fetch ).not.toHaveBeenCalled();
	const { reports } = await check( { ...seen, 'post:2': 'z' }, later );
	expect( reports[ 0 ]?.problem ).toContain( `the links ${ reported } go nowhere` );
} );

it( 'raises a link the site had in one place, written again in another', async () => {
	serve( footer( nav( 'Shop' ) ) );
	const seen = await linksToNowhereChanges.read( site.path );
	serve( header( nav( 'Shop' ) ) + footer( nav( 'Shop' ) ) );
	const { reports } = await check(
		{ ...seen, 'post:2': 'z' },
		await linksToNowhereChanges.read( site.path, seen )
	);
	expect( reports[ 0 ]?.problem ).toContain(
		'the links "Shop" in the header template part go nowhere'
	);
} );
