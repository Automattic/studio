import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { linksToNowhereChanges } from '@studio/agent/node/links-to-nowhere';
import { createFakeHostWithSites } from '@studio/agent/node/tests/fake-host';
import type { HostSite } from '@studio/agent/node/host';

// The home page WordPress renders; none when WordPress cannot render it.
const page = vi.hoisted( () => ( { html: undefined as string | undefined } ) );
const renderFrontPage = vi.hoisted( () =>
	vi.fn( async () => {
		if ( page.html === undefined ) {
			throw new Error( 'the render failed' );
		}
		return { html: page.html };
	} )
);
vi.mock( '@studio/agent/node/front-page-render', () => ( {
	readRenderedVersions: async () => ( { 'post:2': 'a' } ),
	renderFrontPage,
} ) );
// The theme the site's templates come from, and the themes WordPress.org releases.
const themes = vi.hoisted( () => ( {
	active: 'twentytwentyfive',
	released: [ 'twentytwentyfive' ],
} ) );
vi.mock( '@studio/agent/node/site-database', () => ( {
	readWordPressSite: async ( _path: string, read: ( site: unknown ) => unknown ) =>
		read( { option: ( name: string ) => ( name === 'template' ? themes.active : undefined ) } ),
} ) );
vi.mock( '@studio/agent/node/themes', () => ( {
	isUpdatableTheme: async ( _root: string, theme: string ) => themes.released.includes( theme ),
} ) );

const host = createFakeHostWithSites( [
	{ id: '1', name: 'Groomer', path: '/sites/groomer', url: 'http://localhost:8881' },
] );
const site = {
	id: '1',
	name: 'Groomer',
	path: '/sites/groomer',
	url: 'http://localhost:8881',
} as HostSite;
// The footer Twenty Twenty-Five renders, as WordPress 7.1 serves it.
const STOCK_FOOTER = readFileSync(
	path.join( import.meta.dirname, 'fixtures', 'twentytwentyfive-footer.html' ),
	'utf8'
);
const check = ( before: Record< string, string >, after: Record< string, string > ) =>
	linksToNowhereChanges.check( site, before, after, host );
const problem = async () =>
	( await check( { 'post:2': 'a' }, { 'post:2': 'b' } ) ).reports[ 0 ]?.problem;

afterEach( () => {
	themes.active = 'twentytwentyfive';
} );

// The home page WordPress renders from now on.
function serve( html: string | undefined ) {
	page.html = html;
	renderFrontPage.mockClear();
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
			'<main><a class="wp-block-button__link" href="#">Book now</a><a href="#services">Services</a><section id="services"></section><a href="#subscribe">Subscribe</a><a href="#top">Top</a></main>' +
			footer(
				nav( 'Blog' ) + nav( 'FAQ&#039;s &amp; tips' ) + '<a href="#"><img src="x.png"></a>'
			),
		links:
			'"Book now", "Subscribe" (#subscribe) in the page\'s content; "Blog", "FAQ\'s & tips", one with no text in the footer template part',
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
	{ name: 'a site WordPress cannot render', html: undefined },
] )( '$name', async ( { html, links } ) => {
	serve( html );
	if ( links ) {
		expect( await problem() ).toBe(
			`On http://localhost:8881/, the links ${ links } go nowhere: an href of only "#" is an empty fragment, which takes a visitor to the top of the page they are on, and a fragment no element on the page has as its id moves them nowhere (a navigation link prints its url as its href, render_block_core_navigation_link() in wp-includes/blocks/navigation-link.php). Link each to the page, section or form it names, or take it out.`
		);
	} else {
		expect( await problem() ).toBeUndefined();
	}
} );

it( 'renders the site only when a call changed what it renders, and raises the problem at turn end', async () => {
	serve( header( nav( 'Shop' ) ) );
	expect( await check( { 'post:2': 'a' }, { 'post:2': 'a' } ) ).toEqual( { reports: [] } );
	expect( renderFrontPage ).not.toHaveBeenCalled();
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
	const seen = await linksToNowhereChanges.read( sitePath, undefined, host );
	serve( header( nav( 'Shop' ) + nav( 'Book' ) ) + STOCK_FOOTER );
	// A later read keeps what was first seen, without rendering the site.
	const later = await linksToNowhereChanges.read( sitePath, seen, host );
	expect( renderFrontPage ).not.toHaveBeenCalled();
	const { reports } = await check( { ...seen, 'post:2': 'z' }, later );
	expect( reports[ 0 ]?.problem ).toContain( `the links ${ reported } go nowhere` );
} );

it.each< { name: string; now: string; reported: string | undefined } >( [
	{
		name: 'raises a link the site had in one place, written again in another',
		now: header( nav( 'Shop' ) ) + footer( nav( 'Shop' ) ),
		reported: '"Shop" in the header template part',
	},
	{
		// As a saved footer part with no area renders in a <div> (wp-includes/blocks/template-part.php).
		name: 'keeps a link the site had, now rendered in another place',
		now: `<div class="wp-block-template-part">${ nav( 'Shop' ) }</div>`,
		reported: undefined,
	},
] )( '$name', async ( { now, reported } ) => {
	serve( footer( nav( 'Shop' ) ) );
	const seen = await linksToNowhereChanges.read( site.path, undefined, host );
	serve( now );
	const { reports } = await check(
		{ ...seen, 'post:2': 'z' },
		await linksToNowhereChanges.read( site.path, seen, host )
	);
	expect( reports[ 0 ]?.problem ).toEqual(
		reported && expect.stringContaining( `the links ${ reported } go nowhere` )
	);
} );

it.each< { name: string; released: string[]; reported: string | undefined } >( [
	{
		name: "keeps the links a theme WordPress.org releases renders once it is the site's, and raises one written since",
		released: [ 'ollie' ],
		reported: '"Book" in the header template part',
	},
	{
		name: 'raises the links a theme renders that WordPress.org does not release',
		released: [],
		reported: '"Book" in the header template part; "Twitter" in the footer template part',
	},
] )( '$name', async ( { released, reported } ) => {
	themes.released = released;
	serve( header( nav( 'Shop' ) ) );
	const first = await linksToNowhereChanges.read( site.path, undefined, host );
	// The theme is installed and activated, or a child theme of it made.
	themes.active = 'ollie';
	serve( header( nav( 'Shop' ) ) + footer( nav( 'Twitter' ) ) );
	const installed = await linksToNowhereChanges.read( site.path, first, host );
	serve( header( nav( 'Shop' ) + nav( 'Book' ) ) + footer( nav( 'Twitter' ) ) );
	const later = await linksToNowhereChanges.read( site.path, installed, host );
	const { reports } = await check( { ...first, 'post:2': 'z' }, later );
	expect( reports[ 0 ]?.problem ).toContain( `the links ${ reported } go nowhere` );
} );
