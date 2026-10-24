import { expect, it } from 'vitest';
import { createResultNotes } from '../result-notes';
import { readActiveSiteFacts } from '../site-facts';
import { createSite as createWordPressSite } from './fixtures/wordpress-site';

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
	const notes = createResultNotes( new Map( [ [ site.root, await site.facts() ] ] ) );
	// The facts the Active site section stated.
	expect( await notes( site.root, '' ) ).toBe( '' );

	// A call activates WooCommerce, which turns on Coming soon mode.
	site.setOptions( { woocommerce_coming_soon: 'yes', ...WOOCOMMERCE_ACTIVE } );
	expect( await notes( site.root, '' ) ).toBe(
		[
			'Active plugins: woocommerce/woocommerce.php, hello.php.',
			COMING_SOON( 'the site' ),
			'No longer true: Active plugins: none.',
		].join( '\n' )
	);
	expect( await notes( site.root, '' ) ).toBe( '' );

	site.setOptions( { woocommerce_coming_soon: 'no' } );
	expect( await notes( site.root, '' ) ).toBe( `No longer true: ${ COMING_SOON( 'the site' ) }` );

	// A site the agent has no facts for, as over MCP, gets them with its first result.
	expect( await createResultNotes()( site.root, '' ) ).toBe(
		[ ...BASE.slice( 0, 2 ), 'Active plugins: woocommerce/woocommerce.php, hello.php.' ].join(
			'\n'
		)
	);
} );
