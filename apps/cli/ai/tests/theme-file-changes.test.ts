import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
} );
