import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenProblems } from 'cli/ai/open-problems';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { updatableThemeChangeHome, updatableThemeChanges } from 'cli/ai/theme-file-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

let fixture: ReturnType< typeof createSite >;
let site: SiteData;

// Writes a theme file as any tool or script would.
const write = ( file: string, content: string ) => {
	const target = path.join( fixture.root, 'wp-content/themes', file );
	mkdirSync( path.dirname( target ), { recursive: true } );
	writeFileSync( target, content );
};

beforeEach( () => {
	fixture = createSite();
	write( 'twentytwentyfive/theme.json', '{"version":3}' );
	site = { id: '1', name: 'Bakery', path: fixture.root } as SiteData;
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

const checkThemes = () =>
	new SiteChanges( undefined, async () => [ site ], [ updatableThemeChanges ] );

describe( 'updatable theme file changes', () => {
	it.each( [
		{ name: 'an unchanged site', change: () => {}, problem: undefined },
		{
			name: "an edit to an updated theme's file",
			change: () => write( 'twentytwentyfive/theme.json', '{"version":3,"settings":{}}' ),
			problem: "it loses the changes to theme.json. Make them in the site's Global Styles",
		},
		{
			name: 'a new file in an updated theme',
			change: () => write( 'bakery-parent/parts/header.html', '<!-- wp:site-title /-->' ),
			problem: 'it loses the changes to parts/header.html. Make them in a child theme',
		},
		{
			name: "an edit to the user's own theme",
			change: () => write( 'bakery/style.css', '/*\nTheme Name: Bakery\n*/' ),
			problem: undefined,
		},
		{
			name: 'an update of the theme, by WordPress',
			change: () => {
				write( 'twentytwentyfive/style.css', '/*\nVersion: 1.6\n*/' );
				write( 'twentytwentyfive/theme.json', '{"version":3,"new":true}' );
			},
			problem: undefined,
		},
	] )( 'reports $name', async ( { change, problem } ) => {
		const check = checkThemes();
		await check.snapshot();
		change();
		const { problems } = await check.settle();
		expect( problems ).toHaveLength( problem ? 1 : 0 );
		if ( problem ) {
			expect( problems[ 0 ] ).toContain( problem );
		}
	} );

	it.each( [
		{ file: 'theme.json', home: "the site's Global Styles for twentytwentyfive" },
		{ file: 'style.css', home: "the site's Global Styles" },
		{ file: 'assets/css/extra.css', home: "the site's Global Styles" },
		{ file: 'styles/evening.json', home: "the site's Global Styles" },
		{ file: 'templates/home.html', home: 'a template saved for twentytwentyfive' },
		{ file: 'parts/header.html', home: 'a template saved for twentytwentyfive' },
		{ file: 'patterns/hero.php', home: 'a child theme of twentytwentyfive' },
		{ file: 'functions.php', home: 'a child theme of twentytwentyfive' },
	] )( "keeps a block theme's $file in $home", ( { file, home } ) => {
		const dir = path.join( fixture.root, 'wp-content/themes/twentytwentyfive' );
		expect( updatableThemeChangeHome( dir, 'twentytwentyfive', file ) ).toMatch(
			new RegExp( `^${ home.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) }` )
		);
	} );

	it( "keeps a pattern a block theme's templates show in the templates saved for it", () => {
		// As Twenty Twenty-Five's parts/header.html shows its header pattern.
		write(
			'twentytwentyfive/patterns/header.php',
			'<?php\n/**\n * Title: Header\n * Slug: twentytwentyfive/header\n */\n?><!-- wp:group /-->'
		);
		write(
			'twentytwentyfive/parts/header.html',
			'<!-- wp:pattern {"slug":"twentytwentyfive/header"} /-->'
		);
		write(
			'twentytwentyfive/parts/footer.html',
			'<!-- wp:pattern {"slug":"twentytwentyfive/footer"} /-->'
		);
		write(
			'twentytwentyfive/templates/page-wide.html',
			'<!-- wp:pattern {"slug":"twentytwentyfive/header"} /--><!-- wp:post-content /-->'
		);
		const dir = path.join( fixture.root, 'wp-content/themes/twentytwentyfive' );
		expect( updatableThemeChangeHome( dir, 'twentytwentyfive', 'patterns/header.php' ) ).toContain(
			'with the wp_theme term twentytwentyfive for templates/page-wide.html, parts/header.html, which show this pattern through a Pattern block'
		);
		// A pattern only the inserter offers has no template to save.
		write(
			'twentytwentyfive/patterns/hero.php',
			'<?php\n/**\n * Slug: twentytwentyfive/hero\n */'
		);
		expect( updatableThemeChangeHome( dir, 'twentytwentyfive', 'patterns/hero.php' ) ).toMatch(
			/^a child theme of twentytwentyfive/
		);
	} );

	it.each( [
		{ file: 'style.css', home: "the site's Additional CSS" },
		{ file: 'header.php', home: 'a child theme of classic' },
	] )( "keeps a classic theme's $file in $home", ( { file, home } ) => {
		write( 'classic/style.css', '/*\nTheme Name: Classic\n*/' );
		const dir = path.join( fixture.root, 'wp-content/themes/classic' );
		expect( updatableThemeChangeHome( dir, 'classic', file ) ).toContain( home );
	} );

	it( 'names where each kind of change goes when a call changes several', async () => {
		const check = checkThemes();
		await check.snapshot();
		write( 'twentytwentyfive/theme.json', '{"version":3,"settings":{}}' );
		write( 'twentytwentyfive/functions.php', '<?php' );
		const [ problem ] = ( await check.settle() ).problems;
		expect( problem ).toContain(
			"Make each where WordPress saves that kind of change: theme.json in the site's Global Styles"
		);
		expect( problem ).toContain( '; functions.php in a child theme of twentytwentyfive' );
	} );

	it( 'keeps a change open until the released file is back', async () => {
		const check = checkThemes();
		await check.snapshot();
		write( 'twentytwentyfive/theme.json', '{"version":3,"settings":{}}' );
		expect( ( await check.settle() ).problems ).toHaveLength( 1 );

		// A later call that changes the theme again still names the first change.
		await check.snapshot();
		write( 'twentytwentyfive/functions.php', '<?php' );
		expect( ( await check.settle() ).problems[ 0 ] ).toContain( 'theme.json, functions.php' );

		await check.snapshot();
		write( 'twentytwentyfive/theme.json', '{"version":3}' );
		rmSync( path.join( fixture.root, 'wp-content/themes/twentytwentyfive/functions.php' ) );
		expect( ( await check.settle() ).problems ).toEqual( [] );
	} );

	it( "raises a theme made in a WordPress.org theme's folder name once, until it names its Update URI", async () => {
		// WordPress.org, which has the theme ember, "Ember", and updates a theme
		// by that folder name unless its Update URI names another host.
		vi.stubGlobal( 'fetch', async ( url: string, init?: { body: URLSearchParams } ) => {
			if ( url.includes( '/themes/info/' ) ) {
				return Response.json( { name: 'Ember', version: '1.1.4' } );
			}
			const sent: Record< string, { UpdateURI?: string } > = JSON.parse(
				init?.body.get( 'themes' ) ?? '{}'
			).themes;
			return Response.json( {
				themes: Object.fromEntries(
					Object.entries( sent )
						.filter( ( [ theme, { UpdateURI } ] ) => theme === 'ember' && ! UpdateURI )
						.map( ( [ theme ] ) => [ theme, { new_version: '1.1.4' } ] )
				),
				no_update: [],
			} );
		} );
		const open = new OpenProblems( [] );
		const check = new SiteChanges( open, async () => [ site ], [ updatableThemeChanges ] );
		const call = async ( change: () => void ) => {
			await check.snapshot();
			change();
			return ( await check.settle() ).problems;
		};
		try {
			const header = '/*\nTheme Name: Ember Roasters\nVersion: 1.0.0\n';
			expect( await call( () => write( 'ember/style.css', `${ header }*/` ) ) ).toEqual( [
				expect.stringContaining(
					'The theme in ember/ is "Ember Roasters", and WordPress.org\'s theme ember is "Ember": WordPress checks for theme updates by folder name and offers "Ember" 1.1.4'
				),
			] );
			expect( await call( () => write( 'ember/functions.php', '<?php' ) ) ).toEqual( [] );
			expect(
				await call( () => write( 'ember/style.css', `${ header }Update URI: false\n*/` ) )
			).toEqual( [] );
			expect( await open.raise() ).toEqual( [] );
		} finally {
			vi.unstubAllGlobals();
		}
	} );
} );
