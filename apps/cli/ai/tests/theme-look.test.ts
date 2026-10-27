import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { themeLook } from 'cli/ai/theme-look';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/ai/theme-presets', () => ( {
	themePresets: async () => ( { styleVariations: [ 'Evening', 'Noon' ] } ),
} ) );

// WordPress's update check found an update source for the active theme, bakery.
const UPDATED =
	'O:8:"stdClass":2:{s:7:"checked";a:1:{s:6:"bakery";s:3:"1.0";}s:9:"no_update";a:1:{s:6:"bakery";a:0:{}}}';

const roots: string[] = [];
afterEach( () => roots.splice( 0 ).forEach( ( root ) => rmSync( root, { recursive: true } ) ) );

function site( options: Record< string, string > ) {
	const created = createSite();
	roots.push( created.root );
	created.setOptions( { show_on_front: 'page', page_on_front: '7', ...options } );
	return created;
}

async function told( created: ReturnType< typeof createSite >, before = {} ) {
	const after = await themeLook.read( created.root );
	const { reports } = await themeLook.check( { path: created.root } as SiteData, before, after );
	return reports.map( ( report ) => report.summary );
}

it.each<
	[ string, Record< string, string >, ( created: ReturnType< typeof createSite > ) => void ]
>( [
	[ 'a front page of posts', { show_on_front: 'posts' }, () => undefined ],
	[ 'no front page', { page_on_front: '0' }, () => undefined ],
	[
		'a theme WordPress does not update',
		{
			_site_transient_update_themes:
				'O:8:"stdClass":2:{s:7:"checked";a:1:{s:6:"bakery";s:3:"1.0";}s:9:"no_update";a:0:{}}',
		},
		() => undefined,
	],
	[
		'Global Styles WordPress applies',
		{},
		( created ) =>
			created.save(
				9,
				'wp_global_styles',
				'wp-global-styles-bakery',
				'{"version":3,"isGlobalStylesUserThemeJSON":true,"styles":{"color":{"text":"#000"}}}'
			),
	],
	[
		'a template saved for the theme',
		{},
		( created ) => created.save( 9, 'wp_template', 'front-page' ),
	],
] )( 'says nothing of a site with %s', async ( _, options, change ) => {
	const created = site( { _site_transient_update_themes: UPDATED, ...options } );
	change( created );
	expect( await told( created ) ).toEqual( [] );
} );

it( 'says once that a front page built on a theme WordPress updates looks as the theme ships', async () => {
	const created = site( { _site_transient_update_themes: UPDATED } );
	// Global Styles WordPress ignores, without the flag, are no look of the site's own.
	created.save( 9, 'wp_global_styles', 'wp-global-styles-bakery', '{"styles":{"color":{}}}' );
	expect( await told( created ) ).toEqual( [
		"The front page (page 7) is built on bakery, a theme WordPress updates, and the site has no Global Styles, templates or template parts saved of its own, so it looks as bakery ships for every site that uses it. WordPress keeps a site's own look in its Global Styles, as the Site Editor's Styles saves them, a style variation of bakery's (Evening, Noon) or styles of the site's own (WP_Theme_JSON_Resolver::get_user_data() in wp-includes/class-wp-theme-json-resolver.php), in templates and parts saved for the theme (get_block_templates() in wp-includes/block-template-utils.php), or in a theme of the site's own.",
	] );
	// Not again for the same front page, but again for another.
	const shown = await themeLook.read( created.root );
	expect( await told( created, shown ) ).toEqual( [] );
	created.setOptions( { page_on_front: '8' } );
	expect( await told( created, shown ) ).toHaveLength( 1 );
} );

describe( 'the template the front page renders through', () => {
	const PAGE =
		'<!-- wp:template-part {"slug":"header"} /-->\n<!-- wp:group --><div><!-- wp:post-title {"level":1} /-->\n<!-- wp:post-content /--></div><!-- /wp:group -->\n<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->';
	const write = ( created: ReturnType< typeof createSite >, file: string, text: string ) => {
		const target = path.join( created.root, 'wp-content/themes', file );
		mkdirSync( path.dirname( target ), { recursive: true } );
		writeFileSync( target, text );
	};
	const frame = async ( created: ReturnType< typeof createSite > ) => {
		const [ summary ] = await told( created );
		return summary?.split( " or in a theme of the site's own." )[ 1 ];
	};
	const HIERARCHY =
		'(the first the theme has of front-page, page-<slug>, page-7, page, singular, index; get_front_page_template() and get_page_template() in wp-includes/template.php)';

	function bakery() {
		const created = site( { _site_transient_update_themes: UPDATED, template: 'bakery-parent' } );
		created.save( 7, 'page', 'home' );
		return created;
	}

	it( "names its parent's template, what it places, and the page templates both themes offer", async () => {
		const created = bakery();
		write( created, 'bakery-parent/templates/page.html', PAGE );
		write( created, 'bakery-parent/templates/index.html', '' );
		write(
			created,
			'bakery-parent/theme.json',
			JSON.stringify( {
				customTemplates: [
					{ name: 'page-no-title', title: 'Page No Title', postTypes: [ 'page' ] },
					{ name: 'wide' },
					{ name: 'post-plain', title: 'Plain', postTypes: [ 'post' ] },
				],
			} )
		);
		write(
			created,
			'bakery/theme.json',
			JSON.stringify( { customTemplates: [ { name: 'wide', title: 'Wide (child)' } ] } )
		);
		expect( await frame( created ) ).toBe(
			` WordPress renders the front page through bakery-parent/templates/page.html ${ HIERARCHY }, which places the header part, then the page's title (core/post-title), then the page's content (core/post-content), then the footer part. bakery also offers the page templates Wide (child) (wide), Page No Title (page-no-title).`
		);
	} );

	it( "takes its own page-<slug> over its parent's page template, and front-page over both", async () => {
		const created = bakery();
		write( created, 'bakery-parent/templates/page.html', PAGE );
		write( created, 'bakery/templates/page-home.html', '<!-- wp:post-content /-->' );
		expect( await frame( created ) ).toBe(
			` WordPress renders the front page through bakery/templates/page-home.html ${ HIERARCHY }, which places the page's content (core/post-content).`
		);
		write( created, 'bakery-parent/templates/front-page.html', '<!-- wp:post-title /-->' );
		expect( await frame( created ) ).toBe(
			` WordPress renders the front page through bakery-parent/templates/front-page.html ${ HIERARCHY }, which places the page's title (core/post-title).`
		);
	} );

	it( 'names a template that places none of these, and no template where the theme has none', async () => {
		const created = bakery();
		write(
			created,
			'bakery-parent/templates/page-7.html',
			'<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'
		);
		expect( await frame( created ) ).toBe(
			` WordPress renders the front page through bakery-parent/templates/page-7.html ${ HIERARCHY }.`
		);
		rmSync( path.join( created.root, 'wp-content/themes/bakery-parent/templates/page-7.html' ) );
		expect( await frame( created ) ).toBe( '' );
	} );
} );
