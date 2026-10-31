import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { resolveSiteFile } from '@studio/agent/node/site-file-guards';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import { keepThemePresets, themePresets, themePresetsFact } from '@studio/agent/node/theme-presets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveHost } from 'cli/ai/tests/live-host';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';

vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	runWpCliCommand: vi.fn(
		( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ).runWpCliCommand
	),
} ) );

const host = liveHost();
const presetsOf = ( root: string ) =>
	readWordPressSite( root, ( site ) => themePresetsFact( site, host ) );

// A real WordPress install to resolve presets with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe( 'the theme presets fact', () => {
	let fixture: ReturnType< typeof createSite >;
	const resolved = {
		colors: [ [ 'base', '#FFFFFF' ] ],
		fontFamilies: [ [ 'inter', 'Inter' ] ],
		fontSizes: [],
		spacingSizes: [ [ '40', '30px' ] ],
		layout: { contentSize: '645px' },
		styleProperties: { color: 'color.text' },
		shadowed: [],
		styleVariations: [ 'Evening', 'Plain' ],
	};
	let output: () => string;

	beforeEach( () => {
		fixture = createSite();
		output = () => `PHP Notice: noise\n${ JSON.stringify( resolved ) }`;
		vi.mocked( runWpCliCommand )
			.mockReset()
			.mockImplementation( async () => {
				const text = output();
				return {
					response: {
						stdoutText: Promise.resolve( text ),
						exitCode: Promise.resolve( text ? 0 : 1 ),
					},
					[ Symbol.asyncDispose ]: async () => {},
				} as never;
			} );
	} );
	afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

	it( "states WordPress's resolved presets, by slug", async () => {
		expect( await presetsOf( fixture.root ) ).toEqual( [
			'Color presets (wp_get_global_settings()): base #FFFFFF.',
			'Font family presets (wp_get_global_settings()): inter "Inter".',
			'Spacing size presets (wp_get_global_settings()): 40 30px.',
			'Layout (wp_get_global_settings()): content width 645px, wide width none.',
			"Style variations the Site Editor's Styles offers (its styles/*.json, WP_Theme_JSON_Resolver::get_style_variations()): Evening, Plain. Choosing one saves its settings and styles as the site's Global Styles (WP_Theme_JSON_Resolver::get_user_global_styles_post_id()).",
		] );
	} );

	it.each( [
		{ name: 'nothing changed', change: () => {}, again: false },
		{
			name: "a theme's theme.json",
			change: () =>
				writeFileSync(
					path.join( fixture.root, 'wp-content/themes/bakery-parent/theme.json' ),
					'{"version":3}'
				),
			again: true,
		},
		{
			name: 'a style variation of the child theme',
			change: () => {
				mkdirSync( path.join( fixture.root, 'wp-content/themes/bakery/styles' ) );
				writeFileSync(
					path.join( fixture.root, 'wp-content/themes/bakery/styles/dark.json' ),
					'{"version":3}'
				);
			},
			again: true,
		},
		{
			name: "the user's Global Styles",
			change: () => fixture.save( 20, 'wp_global_styles', 'wp-global-styles-bakery', '{}' ),
			again: true,
		},
		{
			name: 'the active theme',
			change: () =>
				fixture.setOptions( { stylesheet: 'twentytwentyfive', template: 'twentytwentyfive' } ),
			again: true,
		},
		{
			name: "an inactive theme's theme.json",
			change: () =>
				writeFileSync(
					path.join( fixture.root, 'wp-content/themes/twentytwentyfive/theme.json' ),
					'{"version":3}'
				),
			again: false,
		},
	] )( 'runs WordPress again when $name changes: $again', async ( { change, again } ) => {
		await presetsOf( fixture.root );
		change();
		await presetsOf( fixture.root );
		expect( runWpCliCommand ).toHaveBeenCalledTimes( again ? 2 : 1 );
	} );

	it( 'keeps the presets of a theme previewed apart from those of the active one', async () => {
		const previewed = () =>
			readWordPressSite( fixture.root, ( site ) => themePresets( host, site, 'twentytwentyfive' ) );
		await presetsOf( fixture.root );
		await previewed();
		await presetsOf( fixture.root );
		await previewed();
		// The active child theme's parent is the active presets'.
		await readWordPressSite( fixture.root, ( site ) =>
			themePresets( host, site, 'bakery-parent' )
		);
		expect( runWpCliCommand ).toHaveBeenCalledTimes( 2 );
	} );

	it( "resolves a child theme previewed again when its parent's files change", async () => {
		fixture.setOptions( { stylesheet: 'twentytwentyfive', template: 'twentytwentyfive' } );
		writeFileSync(
			path.join( fixture.root, 'wp-content/themes/bakery/style.css' ),
			'/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/'
		);
		const previewed = () =>
			readWordPressSite( fixture.root, ( site ) => themePresets( host, site, 'bakery' ) );
		await previewed();
		writeFileSync(
			path.join( fixture.root, 'wp-content/themes/bakery-parent/theme.json' ),
			'{"version":3}'
		);
		await previewed();
		expect( runWpCliCommand ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'states nothing when WordPress cannot run, and asks it again next time', async () => {
		output = () => '';
		expect( await presetsOf( fixture.root ) ).toEqual( [] );
		output = () => JSON.stringify( resolved );
		expect( await presetsOf( fixture.root ) ).toHaveLength( 5 );
	} );
} );

describe.runIf( WORDPRESS )( 'the theme presets fact, resolved by WordPress', () => {
	let root: string;
	beforeEach( () => {
		vi.mocked( runWpCliCommand ).mockRestore();
		root = mkdtempSync( path.join( os.tmpdir(), 'theme-presets-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( "merges the parent and child themes' presets as WordPress does", async () => {
		const theme = ( slug: string, header: string, json: object ) => {
			const dir = path.join( root, 'wp-content/themes', slug );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( path.join( dir, 'style.css' ), `/*\nTheme Name: ${ slug }\n${ header }*/` );
			writeFileSync( path.join( dir, 'theme.json' ), JSON.stringify( { version: 3, ...json } ) );
		};
		theme( 'presets-parent', '', {
			settings: {
				color: { defaultPalette: false, palette: [ { slug: 'ink', color: '#000', name: 'Ink' } ] },
				typography: { fontSizes: [ { slug: 'big', size: '3rem', name: 'Big' } ] },
				layout: { contentSize: '600px', wideSize: '1200px' },
			},
		} );
		theme( 'presets-child', 'Template: presets-parent\n', {
			settings: { color: { palette: [ { slug: 'paper', color: '#fff', name: 'Paper' } ] } },
		} );
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		db.prepare(
			"UPDATE wp_options SET option_value = ? WHERE option_name IN ( 'stylesheet', 'template' )"
		).run( 'presets-child' );
		db.prepare(
			"UPDATE wp_options SET option_value = 'presets-parent' WHERE option_name = 'template'"
		).run();
		db.close();

		const presets = await presetsOf( root );
		// The child's palette replaces the parent's; the rest is inherited.
		expect( presets ).toContain( 'Color presets (wp_get_global_settings()): paper #fff.' );
		expect( presets.find( ( line ) => line.startsWith( 'Font size' ) ) ).toContain( 'big 3rem' );
		expect( presets ).toContain(
			'Layout (wp_get_global_settings()): content width 600px, wide width 1200px.'
		);
		// Neither theme has style variations.
		expect( presets.filter( ( line ) => line.startsWith( 'Style' ) ) ).toEqual( [] );
	}, 60000 );

	it( 'names the style variations of the theme and its parent, as WordPress reads them', async () => {
		const write = ( file: string, json: object ) => {
			const at = path.join( root, 'wp-content/themes', file );
			mkdirSync( path.dirname( at ), { recursive: true } );
			writeFileSync( at, JSON.stringify( { version: 3, ...json } ) );
		};
		mkdirSync( path.join( root, 'wp-content/themes/varied-parent/templates' ), {
			recursive: true,
		} );
		writeFileSync(
			path.join( root, 'wp-content/themes/varied-parent/style.css' ),
			'/*\nTheme Name: varied-parent\n*/'
		);
		writeFileSync( path.join( root, 'wp-content/themes/varied-parent/templates/index.html' ), '' );
		write( 'varied-parent/theme.json', {} );
		write( 'varied-parent/styles/bold.json', {
			title: 'Bold',
			settings: { color: { palette: [ { slug: 'ink', color: '#000', name: 'Ink' } ] } },
			styles: { elements: { heading: { typography: { fontWeight: '800' } } } },
		} );
		write( 'varied-parent/styles/quiet.json', {
			styles: { spacing: { blockGap: '2rem' }, border: { color: '#000', width: '1px' } },
		} );
		// A block style variation is not the theme's.
		write( 'varied-parent/styles/blocks/card.json', {
			title: 'Card',
			blockTypes: [ 'core/group' ],
			styles: { border: { radius: '8px' } },
		} );
		mkdirSync( path.join( root, 'wp-content/themes/varied-child' ), { recursive: true } );
		writeFileSync(
			path.join( root, 'wp-content/themes/varied-child/style.css' ),
			'/*\nTheme Name: varied-child\nTemplate: varied-parent\n*/'
		);
		write( 'varied-child/styles/bold.json', {
			title: 'Bolder',
			styles: { color: { text: '#111' }, typography: { fontSize: '20px' } },
		} );
		// The Site Editor offers these under Colors and Typography instead.
		write( 'varied-child/styles/colors/ink.json', {
			title: 'Ink',
			settings: { color: { palette: [ { slug: 'ink', color: '#000', name: 'Ink' } ] } },
			styles: { elements: { button: { color: { background: '#000' } } } },
		} );
		write( 'varied-child/styles/typography/tight.json', {
			title: 'Tight',
			styles: { typography: { lineHeight: '1.2' }, spacing: { blockGap: '1rem' } },
		} );
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		db.prepare( "UPDATE wp_options SET option_value = ? WHERE option_name = 'stylesheet'" ).run(
			'varied-child'
		);
		db.prepare( "UPDATE wp_options SET option_value = ? WHERE option_name = 'template'" ).run(
			'varied-parent'
		);
		db.close();

		// The child's file replaces its parent's of the same name.
		expect( ( await presetsOf( root ) ).find( ( line ) => line.startsWith( 'Style' ) ) ).toContain(
			'get_style_variations()): Bolder, quiet. '
		);
	}, 60000 );
} );

describe.runIf( WORDPRESS )( 'keepThemePresets', () => {
	let root: string;
	const themeJson = ( slug: string, settings: object ) => {
		const dir = path.join( root, 'wp-content/themes', slug );
		mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
		writeFileSync( path.join( dir, 'templates', 'index.html' ), '' );
		writeFileSync( path.join( dir, 'style.css' ), `/*\nTheme Name: ${ slug }\n*/` );
		const file = path.join( dir, 'theme.json' );
		writeFileSync( file, JSON.stringify( { version: 3, settings } ) );
		return resolveSiteFile( file )!;
	};
	const settingsOf = ( slug: string ) =>
		JSON.parse( readFileSync( path.join( root, 'wp-content/themes', slug, 'theme.json' ), 'utf8' ) )
			.settings;
	const activate = async ( slug: string ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		db.prepare(
			"UPDATE wp_options SET option_value = ? WHERE option_name IN ( 'stylesheet', 'template' )"
		).run( slug );
		db.close();
	};
	const settings = {
		typography: {
			fontSizes: [
				{ slug: 'small', size: '0.875rem', name: 'Small' },
				{ slug: 'huge', size: '5rem', name: 'Huge' },
			],
		},
		color: {
			palette: [
				{ slug: 'black', color: '#111111', name: 'Ink' },
				{ slug: 'ember', color: '#aa3333', name: 'Ember' },
			],
		},
	};
	beforeEach( () => {
		vi.mocked( runWpCliCommand ).mockRestore();
		root = mkdtempSync( path.join( os.tmpdir(), 'shadowed-presets-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( "turns off core's defaults whose slugs the theme's presets take, as Twenty Twenty-Five does", async () => {
		const file = themeJson( 'shadowed', settings );
		await activate( 'shadowed' );
		const notes = await keepThemePresets( host, file );
		const at = path.join( root, 'wp-content/themes/shadowed/theme.json' );
		expect( notes ).toHaveLength( 2 );
		expect( notes ).toContain(
			`Studio set settings.typography.defaultFontSizes to false in ${ at }, as Twenty Twenty-Five's theme.json does: WordPress replaced its settings.typography.fontSizes small with core's default of the same slug (small 13px) while it was on (WP_Theme_JSON::merge() in wp-includes/class-wp-theme-json.php), and now renders the theme's. The editor offers the theme's typography.fontSizes in place of core's.`
		);
		expect( notes.join( '\n' ) ).toContain( 'settings.color.defaultPalette to false' );
		expect( settingsOf( 'shadowed' ) ).toEqual( {
			typography: { ...settings.typography, defaultFontSizes: false },
			color: { ...settings.color, defaultPalette: false },
		} );
		// WordPress renders the theme's presets now, and Studio says nothing more.
		expect(
			( await readWordPressSite( root, ( site ) => themePresets( host, site ) ) )?.shadowed
		).toEqual( [] );
		expect( await keepThemePresets( host, file ) ).toEqual( [] );
	}, 120000 );

	it( 'keeps a default the site names, and says what WordPress does', async () => {
		const file = themeJson( 'shadowed', settings );
		await activate( 'shadowed' );
		// Core's x-large, which the theme does not define, named in its stylesheet.
		writeFileSync(
			path.join( root, 'wp-content/themes/shadowed/style.css' ),
			'/*\nTheme Name: shadowed\n*/\nh1 { font-size: var(--wp--preset--font-size--x-large); }'
		);
		const notes = await keepThemePresets( host, file );
		expect( notes ).toHaveLength( 2 );
		// And as a block's style attribute names it.
		themeJson( 'shadowed', settings );
		writeFileSync(
			path.join( root, 'wp-content/themes/shadowed/templates/index.html' ),
			'<!-- wp:heading {"style":{"typography":{"fontSize":"var:preset|font-size|x-large"}}} -->'
		);
		expect( ( await keepThemePresets( host, file ) ).join( '\n' ) ).toContain(
			"names core's x-large"
		);
		expect( notes ).toContainEqual(
			expect.stringMatching(
				/^WordPress replaces .*settings\.typography\.fontSizes small with core's default .* where the theme or content names core's x-large; renaming/
			)
		);
		expect( settingsOf( 'shadowed' ) ).toEqual( {
			typography: settings.typography,
			color: { ...settings.color, defaultPalette: false },
		} );
	}, 120000 );

	it( "says nothing of another file, and keeps an inactive theme's presets as it renders them once active", async () => {
		const small = {
			typography: { fontSizes: [ { slug: 'small', size: '0.875rem', name: 'Small' } ] },
		};
		const active = themeJson( 'active', small );
		await activate( 'active' );
		expect(
			await keepThemePresets( host, { ...active, theme: { ...active.theme!, file: 'style.css' } } )
		).toEqual( [] );
		// As the Site Editor previews a theme, with its own theme.json, not the active one's.
		const [ inactive, ...rest ] = await keepThemePresets( host, themeJson( 'inactive', small ) );
		expect( rest ).toEqual( [] );
		expect( inactive ).toContain( 'wp-content/themes/inactive/theme.json' );
		expect( settingsOf( 'inactive' ).typography.defaultFontSizes ).toBe( false );
		expect( settingsOf( 'active' ).typography.defaultFontSizes ).toBeUndefined();
		expect( await keepThemePresets( host, themeJson( 'inactive', {} ) ) ).toEqual( [] );
	}, 120000 );
} );
