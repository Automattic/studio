import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { blockTheme, classicThemeQuestion } from 'cli/ai/block-theme';
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

// The broken theme is raised only at the end of the turn, which a theme being written passes through.
it.each( [
	{
		name: 'a block theme made this session',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => write( 'yoga/templates/index.html', '<!-- wp:post-content /-->' ),
		],
	},
	{
		name: 'a theme left with no template',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => write( 'yoga/theme.json', '{}' ),
			() => write( 'yoga/functions.php', '<?php' ),
		],
		broken: 'yoga',
	},
	{
		name: 'a theme left with no template, then deleted',
		calls: [
			() => write( 'yoga/style.css', header( 'Yoga' ) ),
			() => rmSync( path.join( fixture.root, 'wp-content/themes/yoga' ), { recursive: true } ),
		],
	},
	{
		// The user chose it (classicThemeQuestion).
		name: 'a classic theme made this session',
		calls: [ () => write( 'yoga/style.css', header( 'Yoga' ) ), () => write( 'yoga/index.php' ) ],
	},
	{
		name: 'a theme installed from WordPress.org, with no template',
		calls: [ () => write( 'installed/style.css', `${ header( 'Installed' ) }\nVersion: 1.0` ) ],
	},
] )( 'raises at the end of the turn $name', async ( { calls, broken } ) => {
	const open = new OpenProblems( [] );
	const changes = new SiteChanges( open, async () => [ site ], [ blockTheme ] );
	const results: string[] = [];
	for ( const call of [ ...calls, () => write( 'legacy/footer.php' ) ] ) {
		await changes.snapshot();
		call();
		results.push( ...( await changes.settle() ).problems );
	}
	expect( results ).toEqual( [] );
	expect( await open.raise() ).toEqual(
		broken
			? [
					`${ broken } (wp-content/themes/${ broken }), made this session, has neither templates/index.html nor index.php, so WordPress lists it as broken: "Template is missing. Standalone themes need to have a templates/index.html or index.php template file." (WP_Theme::__construct() in wp-includes/class-wp-theme.php). WordPress's default theme, twentytwentyfive (WP_DEFAULT_THEME), is a block theme with templates/index.html. Give ${ broken } its templates/index.html.`,
			  ]
			: []
	);
} );

it.each( [
	{
		name: 'the first PHP template of a theme being made',
		before: [ 'yoga/style.css' ],
		file: 'yoga/header.php',
		asks: true,
	},
	{ name: 'the first file of a theme', file: 'yoga/index.php', asks: true },
	{ name: "a theme's functions.php", before: [ 'yoga/style.css' ], file: 'yoga/functions.php' },
	{
		name: 'a PHP file below the theme root',
		before: [ 'yoga/style.css' ],
		file: 'yoga/inc/setup.php',
	},
	{ name: 'a block template', before: [ 'yoga/style.css' ], file: 'yoga/templates/index.html' },
	{
		name: 'a PHP template of a block theme',
		before: [ 'yoga/style.css', 'yoga/templates/index.html' ],
		file: 'yoga/page.php',
	},
	{ name: 'a further template of a classic theme', file: 'legacy/page.php' },
	{ name: 'a child theme', before: [ 'legacy-child/style.css' ], file: 'legacy-child/page.php' },
	{
		name: 'a theme WordPress updates',
		before: [ 'installed/style.css' ],
		file: 'installed/index.php',
	},
] )( 'asks before writing $name: $asks', async ( { before = [], file, asks } ) => {
	for ( const written of before ) {
		write(
			written,
			written.endsWith( 'style.css' )
				? {
						'yoga/style.css': header( 'Yoga' ),
						'legacy-child/style.css': header( 'Legacy child', 'legacy' ),
						'installed/style.css': `${ header( 'Installed' ) }\nVersion: 1.0`,
				  }[ written ]
				: ''
		);
	}
	const question = await classicThemeQuestion(
		path.join( fixture.root, 'wp-content/themes', file )
	);
	expect( question ).toEqual(
		asks
			? {
					question: 'Make "yoga" a classic theme?',
					consequence:
						'Its templates are PHP files, edited only in code: the Site Editor cannot edit its templates, header, footer or styles.',
					declined:
						'"yoga" is to be a block theme, as WordPress\'s default theme, twentytwentyfive (WP_DEFAULT_THEME), is: its templates are block markup in templates/*.html, with templates/index.html (WP_Theme::is_block_theme() in wp-includes/class-wp-theme.php), and its parts in parts/*.html, all edited in the Site Editor.',
			  }
			: undefined
	);
} );
