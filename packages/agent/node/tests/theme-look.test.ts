import { rmSync } from 'fs';
import { afterEach, expect, it, vi } from 'vitest';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import { themeLook } from '@studio/agent/node/theme-look';
import type { HostSite } from '@studio/agent/node/host';

const host = createFakeHost();

vi.mock( '@studio/agent/node/theme-presets', () => ( {
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
	const after = await themeLook.read( created.root, undefined, host );
	const { reports } = await themeLook.check(
		{ path: created.root } as HostSite,
		before,
		after,
		host
	);
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
	const shown = await themeLook.read( created.root, undefined, host );
	expect( await told( created, shown ) ).toEqual( [] );
	created.setOptions( { page_on_front: '8' } );
	expect( await told( created, shown ) ).toHaveLength( 1 );
} );
