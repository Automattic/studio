import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { expect, it, vi } from 'vitest';
import { createFakeHost, fakeSite } from '@studio/agent/node/tests/fake-host';
import { readActiveSiteFacts } from '../site-facts';
import { createSiteNotes } from '../site-notes';
import { createSite as createWordPressSite } from './fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

// The site's WordPress is not run: what its code registers is read by admin-capabilities' tests.
const host = createFakeHost();

function createSite( prefix: string ) {
	const site = createWordPressSite( prefix );
	const factGroups = () =>
		readActiveSiteFacts( host, { name: 'Site', path: site.root, running: true } );
	const facts = async () => ( await factGroups() ).flat();
	return { ...site, facts, factGroups };
}

const WOOCOMMERCE_ACTIVE = {
	active_plugins: 'a:2:{i:0;s:27:"woocommerce/woocommerce.php";i:1;s:9:"hello.php";}',
};
const BASE = [
	'WordPress 7.1.3.',
	'Active theme: bakery; a child theme of bakery-parent, which WordPress updates.',
	'Active plugins: none.',
];
const STORE_WITHOUT_PAGES =
	'WooCommerce store: no Shop page (woocommerce_shop_page_id), no Cart page (woocommerce_cart_page_id), no Checkout page (woocommerce_checkout_page_id), no My account page (woocommerce_myaccount_page_id); 0 published products.';
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
		STORE_WITHOUT_PAGES,
	] );
} );

it( 'states that WordPress is not installed until the site first starts', async () => {
	const site = createSite( 'wp_' );
	rmSync( path.join( site.root, 'wp-content/database' ), { recursive: true } );
	expect( await site.facts() ).toEqual( [
		'WordPress 7.1.3.',
		'WordPress is not installed yet (is_blog_installed()): Studio installs it, with its database, when the site first starts (site_start).',
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
		// Copies that replace nothing: another theme's, a draft, and Global Styles
		// WordPress does not apply, without the flag (WP_Theme_JSON_Resolver::get_user_data()).
		site.save( 11, 'wp_template_part', 'header', '', 2 );
		site.save( 12, 'wp_template_part', 'header', '', 1, 'draft' );
		site.save(
			13,
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"version":3,"styles":{"color":{"text":"#000"}}}'
		);
		expect( await site.facts() ).toEqual( BASE );
		// For a block theme, that nothing replaces its files is a fact too.
		mkdirSync( path.join( site.root, 'wp-content/themes/bakery-parent/templates' ) );
		writeFileSync(
			path.join( site.root, 'wp-content/themes/bakery-parent/templates/index.html' ),
			''
		);
		expect( await site.facts() ).toEqual( [
			...BASE,
			"Nothing is saved in the Site Editor for the active theme, so WordPress renders its templates, parts and theme.json as the theme's files have them.",
		] );

		// An older copy of the header, then the latest, which WordPress renders.
		site.save( 10, 'wp_template_part', 'header' );
		site.save( 14, 'wp_template_part', 'header' );
		site.save( 16, 'wp_template', 'front-page' );
		site.save(
			15,
			'wp_global_styles',
			'wp-global-styles-bakery',
			'{"version":3,"isGlobalStylesUserThemeJSON":true,"styles":{"color":{},"typography":{},"blocks":{"core/button":{}}},"settings":{"color":{}}}'
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
		expect( facts.filter( ( fact ) => fact.includes( 'Coming soon' ) ) ).toEqual(
			pages ? [ COMING_SOON( pages ) ] : []
		);
	}
);

it.each( [
	{
		name: 'Jetpack before it connects',
		options: {
			active_plugins: 'a:1:{i:0;s:19:"jetpack/jetpack.php";}',
			jetpack_active_modules: 'a:2:{i:0;s:12:"contact-form";i:1;s:6:"blocks";}',
			jetpack_options: 'a:1:{s:7:"version";s:6:"16.3.1";}',
		},
		modules: {
			'subscriptions.php': 'Module Name: Newsletter\n * Requires Connection: Yes',
			'contact-form.php': 'Module Name: Forms\n * Requires Connection: No',
			// Jetpack takes a module that does not say as needing a connection.
			'stats.php': 'Module Name: Jetpack Stats',
			'module-info.php': 'Not a module',
		},
		fact: 'Jetpack modules active (jetpack_active_modules): contact-form, blocks. Jetpack is not connected to WordPress.com (jetpack_options id). Until it is, Jetpack activates none of the modules whose header in jetpack/modules says they require a connection (Modules::activate()): stats, subscriptions.',
	},
	{
		name: 'Jetpack registered with WordPress.com, no modules',
		options: {
			active_plugins: 'a:1:{i:0;s:19:"jetpack/jetpack.php";}',
			jetpack_options: 'a:1:{s:2:"id";i:4242;}',
		},
		modules: { 'subscriptions.php': 'Module Name: Newsletter\n * Requires Connection: Yes' },
		fact: 'Jetpack modules active (jetpack_active_modules): none. Jetpack is registered with WordPress.com as site 4242 (jetpack_options id).',
	},
	{
		name: "WooCommerce's store pages and products",
		options: {
			...WOOCOMMERCE_ACTIVE,
			woocommerce_shop_page_id: '20',
			woocommerce_cart_page_id: '21',
			woocommerce_checkout_page_id: '99',
		},
		fact: "WooCommerce store: Shop page 20 (/shop/, publish), Cart page 21 (/cart/, draft), no Checkout page (woocommerce_checkout_page_id), no My account page (woocommerce_myaccount_page_id); 3 published products, 1 of them with no product type (product_type), which WooCommerce's product queries need (wc_get_products()) and WooCommerce sets when it saves a product.",
	},
	{
		name: 'modules and store pages an inactive plugin left behind',
		options: {
			jetpack_active_modules: 'a:1:{i:0;s:6:"blocks";}',
			woocommerce_shop_page_id: '20',
		},
		fact: undefined,
	},
] as Array< {
	name: string;
	options: Record< string, string >;
	modules?: Record< string, string >;
	fact?: string;
} > )( 'states $name', async ( { options, modules = {}, fact } ) => {
	const site = createSite( 'wp_' );
	const dir = path.join( site.root, 'wp-content/plugins/jetpack/modules' );
	mkdirSync( dir, { recursive: true } );
	for ( const [ file, header ] of Object.entries( modules ) ) {
		writeFileSync( path.join( dir, file ), `<?php\n/**\n * ${ header }\n */\n` );
	}
	site.save( 20, 'page', 'shop' );
	site.save( 21, 'page', 'cart', '', 1, 'draft' );
	// A product WooCommerce saved, with its type, and one saved as a plain post.
	site.save( 22, 'product', 'candle', '', 3 );
	site.save( 25, 'product', 'mug', '', 0 );
	site.save( 26, 'product', 'tea', '', 3 );
	site.save( 23, 'product', 'soap', '', 1, 'draft' );
	site.save( 24, 'product', 'gift-box', '', 1, 'trash' );
	site.setOptions( options );
	const facts = await site.facts();
	expect( facts.filter( ( line ) => /^(Jetpack|WooCommerce store)/.test( line ) ) ).toEqual(
		fact ? [ fact ] : []
	);
} );

it( 'has no facts of its own for a WordPress.com site, or for no site', async () => {
	expect(
		await readActiveSiteFacts( host, {
			name: 'Live',
			path: '',
			running: false,
			remote: { host: 'wpcom', id: 7 },
		} )
	).toEqual( [] );
	expect( await readActiveSiteFacts( host, null ) ).toEqual( [] );
} );

it( 'adds to a tool result the facts the agent does not have yet, as they now read, and the ones no longer true', async () => {
	const site = createSite( 'wp_' );
	const siteNotes = createSiteNotes( host, {
		stated: new Map( [ [ site.root, await site.factGroups() ] ] ),
	} );
	const notes = ( session = siteNotes ) => session.afterResult( site.root, '' );
	const said = ( ...lines: string[] ) => lines;
	// The facts the Active site section stated.
	expect( await notes() ).toEqual( [] );
	// The same site, named by a path that resolves to it.
	expect( await siteNotes.afterResult( `${ site.root }/`, '' ) ).toEqual( [] );

	// A call activates WooCommerce, which turns on Coming soon mode; the
	// plugins line replaces the one it was.
	site.setOptions( { woocommerce_coming_soon: 'yes', ...WOOCOMMERCE_ACTIVE } );
	expect( await notes() ).toEqual(
		said(
			'Active plugins: woocommerce/woocommerce.php, hello.php.',
			STORE_WITHOUT_PAGES,
			COMING_SOON( 'the site' )
		)
	);

	// Starting the site updates WordPress.
	writeFileSync(
		path.join( site.root, 'wp-includes/version.php' ),
		"<?php\n$wp_version = '7.1.4';\n"
	);
	expect( await notes() ).toEqual( said( 'WordPress 7.1.4.' ) );
	expect( await notes() ).toEqual( [] );

	site.setOptions( { woocommerce_coming_soon: 'no' } );
	expect( await notes() ).toEqual( said( `No longer true: ${ COMING_SOON( 'the site' ) }` ) );

	// A site the agent has no facts for, as over MCP, gets them with its first result.
	expect( await notes( createSiteNotes( host ) ) ).toEqual(
		said(
			'WordPress 7.1.4.',
			BASE[ 1 ],
			'Active plugins: woocommerce/woocommerce.php, hello.php.',
			STORE_WITHOUT_PAGES
		)
	);
} );

// Studio defines the address as WP_HOME, so it is what home_url() returns, and
// WP_DEBUG_LOG from the site's debug log setting.
it.each( [
	{
		studioSite: { url: 'http://localhost:9098' },
		address: 'http://localhost:9098',
		logged: false,
		running: true,
		state: 'Studio is serving the site there now.',
	},
	{
		studioSite: { url: 'https://bakery.local', enableDebugLog: true },
		address: 'https://bakery.local',
		logged: true,
		running: false,
		state: 'The site is stopped: site_start serves it.',
	},
] )(
	'states the address Studio serves the site at, and whether it serves it now: $address',
	async ( { studioSite, address, logged, running, state } ) => {
		const site = createSite( 'wp_' );
		vi.mocked( host.sites.isRunning ).mockResolvedValueOnce( running );
		vi.mocked( host.sites.findByFolder ).mockImplementation( async ( folder ) =>
			folder === site.root
				? ( { ...fakeSite, path: site.root, ...studioSite } as HostSite )
				: undefined
		);
		expect( await site.facts() ).toEqual( [
			`Address: ${ address } (home_url()). ${ state }`,
			`WP-CLI: \`studio wp <command>\` run in ${ site.root } runs it on this site, on Studio's PHP and with its SQLite database (wp-content/db.php).`,
			logged
				? `PHP errors: WordPress logs them to ${ site.root }/wp-content/debug.log (WP_DEBUG_LOG, wp_debug_mode() in wp-includes/load.php).`
				: `PHP errors: WordPress logs none, as WP_DEBUG_LOG is off (wp_debug_mode() in wp-includes/load.php). \`studio config set --debug-log\` run in ${ site.root } turns it on and restarts the site, and WordPress then logs them to ${ site.root }/wp-content/debug.log; Studio defines WP_DEBUG and WP_DEBUG_LOG in wp-config.php from that setting each time the site starts.`,
			...BASE,
		] );
		vi.mocked( host.sites.findByFolder ).mockReset();
	}
);

// get_permalink() of each page (_get_page_link()): the homepage at the root, a
// viewable page at its parents' slugs and its own, any other at ?page_id.
it.each( [
	{
		structure: '/%year%/%postname%/',
		addresses: [ '/', '/about/', '/about/team/', '/?page_id=12', '/members/' ],
	},
	{
		structure: '/%postname%',
		addresses: [ '/', '/about', '/about/team', '/?page_id=12', '/members' ],
	},
	{
		structure: '',
		addresses: [ '/', '/?page_id=10', '/?page_id=11', '/?page_id=12', '/?page_id=13' ],
	},
] )(
	"states how many pages the site has, and keeps each one's address and title in an index: $structure",
	async ( { structure, addresses } ) => {
		vi.stubEnv( 'DEV_CONFIG_DIR', mkdtempSync( path.join( os.tmpdir(), 'config-' ) ) );
		const site = createSite( 'wp_' );
		site.setOptions( {
			permalink_structure: structure,
			show_on_front: 'page',
			page_on_front: '9',
		} );
		site.save( 9, 'page', 'home', '', 1, 'publish', 'Home' );
		site.save( 10, 'page', 'about', '', 1, 'publish', 'About\tus' );
		site.save( 11, 'page', 'team', '', 1, 'publish', 'Team', 10 );
		site.save( 12, 'page', 'draft-page', '', 1, 'draft', 'Draft' );
		site.save( 13, 'page', 'members', '', 1, 'private', 'Members' );
		site.save( 14, 'page', 'gone', '', 1, 'trash', 'Gone' );
		vi.mocked( host.sites.findByFolder ).mockResolvedValue( {
			...fakeSite,
			id: 'site-id',
			path: site.root,
		} as HostSite );
		try {
			const index = path.join( process.env.DEV_CONFIG_DIR!, 'workspace/site-id/pages.tsv' );
			expect( await site.facts() ).toContain(
				`Pages: 5; each one's ID, status, slug, address on the site and title are in ${ index }, one per line.`
			);
			expect( readFileSync( index, 'utf8' ) ).toBe(
				[
					'ID\tstatus\tslug\taddress\ttitle',
					`9\tpublish\thome\t${ addresses[ 0 ] }\tHome`,
					`10\tpublish\tabout\t${ addresses[ 1 ] }\tAbout us`,
					`11\tpublish\tteam\t${ addresses[ 2 ] }\tTeam`,
					`12\tdraft\tdraft-page\t${ addresses[ 3 ] }\tDraft`,
					`13\tprivate\tmembers\t${ addresses[ 4 ] }\tMembers`,
					'',
				].join( '\n' )
			);
		} finally {
			vi.mocked( host.sites.findByFolder ).mockReset();
			vi.unstubAllEnvs();
		}
	}
);

// As run h2h5's store: about.jpg's attachment took "about", so its About page got about-2.
it( 'states each page WordPress gave a numbered slug, and what holds the one asked for', async () => {
	vi.stubEnv( 'DEV_CONFIG_DIR', mkdtempSync( path.join( os.tmpdir(), 'config-' ) ) );
	const site = createSite( 'wp_' );
	site.save( 10, 'page', 'about-2', '', 1, 'publish', 'About' );
	site.save( 11, 'attachment', 'about', '', 1, 'inherit', 'about' );
	site.save( 12, 'page', 'shop', '', 1, 'publish', 'Shop' );
	site.save( 13, 'page', 'team', '', 1, 'publish', 'Team', 12 );
	site.save( 14, 'page', 'team-2', '', 1, 'publish', 'Team' );
	site.save( 15, 'page', 'shop-all', '', 1, 'publish', 'All' );
	vi.mocked( host.sites.findByFolder ).mockResolvedValue( {
		...fakeSite,
		id: 'site-id',
		path: site.root,
	} as HostSite );
	try {
		expect( ( await site.facts() ).filter( ( fact ) => fact.startsWith( 'Page ' ) ) ).toEqual( [
			'Page 10 has the slug about-2, not about, as attachment 11 holds about: WordPress gives a page and the pages and attachments under its parent one set of slugs (wp_unique_post_slug() in wp-includes/post.php).',
		] );
	} finally {
		vi.mocked( host.sites.findByFolder ).mockReset();
		vi.unstubAllEnvs();
	}
} );
