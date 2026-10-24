import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockTheme } from 'cli/ai/block-theme';
import { OpenProblems } from 'cli/ai/open-problems';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import type { SiteData } from 'cli/lib/cli-config/core';

let fixture: ReturnType< typeof createSite >;
let site: SiteData;

// Writes a theme file as any tool or script would.
const write = ( file: string, content = '' ) => {
	const target = path.join( fixture.root, 'wp-content/themes', file );
	mkdirSync( path.dirname( target ), { recursive: true } );
	writeFileSync( target, content );
};
const header = ( name: string, parent?: string ) =>
	`/*\nTheme Name: ${ name }\n${ parent ? `Template: ${ parent }\n` : '' }*/`;

beforeEach( () => {
	fixture = createSite();
	writeFileSync(
		path.join( fixture.root, 'wp-includes/default-constants.php' ),
		"<?php\n\tif ( ! defined( 'WP_DEFAULT_THEME' ) ) {\n\t\tdefine( 'WP_DEFAULT_THEME', 'twentytwentyfive' );\n\t}\n"
	);
	// A classic theme the site had before the session.
	write( 'legacy/style.css', header( 'Legacy' ) );
	write( 'legacy/index.php', '<?php get_header();' );
	site = { id: '1', name: 'Yoga', path: fixture.root } as SiteData;
	// WordPress.org updates only the theme named "installed".
	vi.stubGlobal( 'fetch', async ( _url: string, init: { body: URLSearchParams } ) => {
		const { themes } = JSON.parse( init.body.get( 'themes' ) ?? '{}' );
		return new Response(
			JSON.stringify( { themes: {}, no_update: 'installed' in themes ? themes : {} } )
		);
	} );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	rmSync( fixture.root, { recursive: true, force: true } );
} );

// `shown` counts the call results that tell of the problem.
it.each( [
	{
		name: 'a classic theme made this session',
		calls: [ () => write( 'yoga/style.css', header( 'Yoga' ) ), () => write( 'yoga/index.php' ) ],
		shown: 1,
		classic: 'yoga',
	},
	{
		name: 'a block theme made this session',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => write( 'yoga/templates/index.html', '<!-- wp:post-content /-->' ),
		],
		shown: 0,
		classic: undefined,
	},
	{
		name: 'a theme still being written, with neither index',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => write( 'yoga/theme.json', '{}' ),
		],
		shown: 0,
		classic: undefined,
	},
	{
		name: 'a classic theme made this session, then given a block template index',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => write( 'yoga/index.php' ),
			() => write( 'yoga/templates/index.html', '<!-- wp:post-content /-->' ),
		],
		shown: 1,
		classic: undefined,
	},
	{
		name: 'a classic theme made this session, then deleted',
		calls: [
			() => {
				write( 'yoga/style.css', header( 'Yoga' ) );
				write( 'yoga/index.php' );
			},
			() => rmSync( path.join( fixture.root, 'wp-content/themes/yoga' ), { recursive: true } ),
		],
		shown: 1,
		classic: undefined,
	},
	{
		name: 'a classic theme the site had, edited',
		calls: [ () => write( 'legacy/page.php', '<?php the_content();' ) ],
		shown: 0,
		classic: undefined,
	},
	{
		name: 'a child, made this session, of the classic theme the site had',
		calls: [
			() => {
				write( 'legacy-child/style.css', header( 'Legacy child', 'legacy' ) );
				write( 'legacy-child/index.php' );
			},
		],
		shown: 0,
		classic: undefined,
	},
	{
		name: 'a classic theme installed from WordPress.org',
		calls: [
			() => {
				write( 'installed/style.css', `${ header( 'Installed' ) }\nVersion: 1.0` );
				write( 'installed/index.php' );
			},
		],
		shown: 0,
		classic: undefined,
	},
] )( 'raises at the end of the turn $name', async ( { calls, shown, classic } ) => {
	const open = new OpenProblems( [] );
	const changes = new SiteChanges( open, async () => [ site ], [ blockTheme ] );
	const results: string[] = [];
	for ( const call of [ ...calls, () => write( 'legacy/footer.php' ) ] ) {
		await changes.snapshot();
		call();
		results.push( ...( await changes.settle() ).problems );
	}
	// A problem is told on the result of the call that made it, once.
	expect( results ).toHaveLength( shown );
	expect( await open.raise() ).toEqual(
		classic
			? [
					expect.stringMatching(
						new RegExp(
							`^${ classic } \\(wp-content/themes/${ classic }\\), made this session, is a classic theme: .*WP_Theme::is_block_theme\\(\\).*WordPress's default theme, twentytwentyfive \\(WP_DEFAULT_THEME\\), is a block theme: its templates are block markup in templates/\\*\\.html`
						)
					),
			  ]
			: []
	);
} );
