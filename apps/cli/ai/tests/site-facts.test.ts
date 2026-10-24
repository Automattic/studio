import { expect, it, vi } from 'vitest';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';
import { readActiveSiteFacts } from '../site-facts';
import { createSiteNotes } from '../site-notes';
import { createSite as createWordPressSite } from './fixtures/wordpress-site';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/cli-config/sites', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/sites') >() ),
	findSiteByFolder: vi.fn(),
} ) );

function createSite( prefix: string ) {
	const site = createWordPressSite( prefix );
	const facts = () => readActiveSiteFacts( { name: 'Site', path: site.root, running: true } );
	return { ...site, facts };
}

const WOOCOMMERCE_ACTIVE = {
	active_plugins: 'a:2:{i:0;s:27:"woocommerce/woocommerce.php";i:1;s:9:"hello.php";}',
};
const BASE = [
	'WordPress 7.1.3.',
	'Active theme: bakery; a child theme of bakery-parent, which WordPress updates.',
	'Active plugins: none.',
];
const COMING_SOON = ( pages: string ) =>
	`WooCommerce's Coming soon mode is on (woocommerce_coming_soon): visitors who are not logged in, including screenshots, get a Coming soon page instead of ${ pages }.`;

it( 'states the WordPress version, the active theme and whether WordPress updates it, and the active plugins', async () => {
	const site = createSite( 'wp_' );
	expect( await site.facts() ).toEqual( BASE );

	site.setOptions( {
		...WOOCOMMERCE_ACTIVE,
		stylesheet: 'twentytwentyfive',
		template: 'twentytwentyfive',
	} );
	expect( await site.facts() ).toEqual( [
		'WordPress 7.1.3.',
		'Active theme: twentytwentyfive, which WordPress updates.',
		'Active plugins: woocommerce/woocommerce.php, hello.php.',
	] );
} );

it.each( [
	{ reading: { show_on_front: 'posts' }, fact: 'Homepage: the latest posts (show_on_front).' },
	{
		reading: { show_on_front: 'page', page_on_front: '9' },
		fact: 'Homepage: page 9 "Home" (show_on_front, page_on_front).',
	},
	{
		reading: { show_on_front: 'page', page_on_front: '9', page_for_posts: '10' },
		fact: 'Homepage: page 9 "Home" (show_on_front, page_on_front); posts page: page 10 "News" (page_for_posts).',
	},
	// WordPress queries the page Reading names, whatever became of it.
	{
		reading: { show_on_front: 'page', page_on_front: '99' },
		fact: 'Homepage: page 99, which does not exist (show_on_front, page_on_front).',
	},
	{
		reading: { show_on_front: 'page', page_on_front: '11' },
		fact: 'Homepage: page 11 "Old home" (trash) (show_on_front, page_on_front).',
	},
	{
		reading: { show_on_front: 'page', page_on_front: '0' },
		fact: 'Homepage: the latest posts (show_on_front).',
	},
] )( 'states what Settings → Reading shows at the homepage: $fact', async ( { reading, fact } ) => {
	const site = createSite( 'wp_' );
	site.save( 9, 'page', 'home', '', 1, 'publish', 'Home' );
	site.save( 10, 'page', 'news', '', 1, 'publish', 'News' );
	site.save( 11, 'page', 'old-home', '', 1, 'trash', 'Old home' );
	site.setOptions( reading as Record< string, string > );
	const titled = ( await site.facts() ).find( ( line ) => line.startsWith( 'Homepage:' ) );
	expect( titled ).toBe( fact );
} );

// Imported sites can name their tables with a prefix other than wp_.
it.each( [ 'wp_', 'site2_' ] )(
	'states the copies saved in the Site Editor that WordPress renders instead of theme files (%s tables)',
	async ( prefix ) => {
		const site = createSite( prefix );
		// Copies that replace nothing: another theme's, a draft, and empty Global Styles.
		site.save( 11, 'wp_template_part', 'header', '', 2 );
		site.save( 12, 'wp_template_part', 'header', '', 1, 'draft' );
		site.save( 13, 'wp_global_styles', 'wp-global-styles-bakery', '{"version":3,"styles":{}}' );
		expect( await site.facts() ).toEqual( BASE );

		// An older copy of the header, then the latest, which WordPress renders.
		site.save( 10, 'wp_template_part', 'header' );
		site.save( 14, 'wp_template_part', 'header' );
		site.save( 16, 'wp_template', 'front-page' );
		site.save(
			15,
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"version":3,"styles":{"color":{},"typography":{},"blocks":{"core/button":{}}},"settings":{"color":{}}}'
		);
		expect( await site.facts() ).toEqual( [
			...BASE,
			"Saved in the Site Editor, so WordPress renders them in place of the active theme's files: Global Styles (post 15), setting color, typography, 1 block style, and color settings over theme.json; the template front-page (post 16), instead of templates/front-page.html; the template part header (post 14), instead of parts/header.html.",
		] );
	}
);

it.each( [
	[ 'is on', { woocommerce_coming_soon: 'yes', ...WOOCOMMERCE_ACTIVE }, 'the site' ],
	[
		'covers only the store pages',
		{ woocommerce_coming_soon: 'yes', woocommerce_store_pages_only: 'yes', ...WOOCOMMERCE_ACTIVE },
		'its store pages',
	],
	[ 'is off', { woocommerce_coming_soon: 'no', ...WOOCOMMERCE_ACTIVE }, undefined ],
	[ 'is left from an inactive WooCommerce', { woocommerce_coming_soon: 'yes' }, undefined ],
] )(
	"states whether visitors get WooCommerce's Coming soon page when it %s",
	async ( _, options, pages ) => {
		const site = createSite( 'wp_' );
		site.setOptions( options );
		const facts = await site.facts();
		expect( facts.slice( 3 ) ).toEqual( pages ? [ COMING_SOON( pages ) ] : [] );
	}
);

it( 'has no facts for a WordPress.com site without a known site ID, or no site', async () => {
	expect(
		await readActiveSiteFacts( { name: 'Live', path: '', running: false, remote: true } )
	).toEqual( [] );
	expect( await readActiveSiteFacts( null ) ).toEqual( [] );
} );

it( 'adds to a tool result the facts the agent does not have yet and the ones no longer true', async () => {
	const site = createSite( 'wp_' );
	const siteNotes = createSiteNotes( { stated: new Map( [ [ site.root, await site.facts() ] ] ) } );
	const notes = ( session = siteNotes ) => session.afterResult( site.root, '' );
	const said = ( ...lines: string[] ) => lines;
	// The facts the Active site section stated.
	expect( await notes() ).toEqual( [] );

	// A call activates WooCommerce, which turns on Coming soon mode.
	site.setOptions( { woocommerce_coming_soon: 'yes', ...WOOCOMMERCE_ACTIVE } );
	expect( await notes() ).toEqual(
		said(
			'Active plugins: woocommerce/woocommerce.php, hello.php.',
			COMING_SOON( 'the site' ),
			'No longer true: Active plugins: none.'
		)
	);
	expect( await notes() ).toEqual( [] );

	site.setOptions( { woocommerce_coming_soon: 'no' } );
	expect( await notes() ).toEqual( said( `No longer true: ${ COMING_SOON( 'the site' ) }` ) );

	// A site the agent has no facts for, as over MCP, gets them with its first result.
	expect( await notes( createSiteNotes() ) ).toEqual(
		said( ...BASE.slice( 0, 2 ), 'Active plugins: woocommerce/woocommerce.php, hello.php.' )
	);
} );

// Studio defines the address as WP_HOME, so it is what home_url() returns.
it.each( [
	{ studioSite: { port: 9098 }, address: 'http://localhost:9098' },
	{
		studioSite: { port: 9098, customDomain: 'bakery.local', enableHttps: true },
		address: 'https://bakery.local',
	},
] )(
	'states the address Studio serves the site at: $address',
	async ( { studioSite, address } ) => {
		const site = createSite( 'wp_' );
		vi.mocked( findSiteByFolder ).mockImplementation( async ( folder ) =>
			folder === site.root ? ( studioSite as SiteData ) : undefined
		);
		expect( await site.facts() ).toEqual( [ `Address: ${ address } (home_url()).`, ...BASE ] );
		vi.mocked( findSiteByFolder ).mockReset();
	}
);
