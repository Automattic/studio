import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWordPressSite } from 'cli/ai/site-database';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { themePresetsFact } from 'cli/ai/theme-presets';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/ai/tools/utils', () => ( {
	resolveSite: async ( root: string ) => ( { id: 'site', name: 'Site', path: root } ),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', async ( importOriginal ) => ( {
	runWpCliCommand: vi.fn(
		( await importOriginal< typeof import('cli/lib/run-wp-cli-command') >() ).runWpCliCommand
	),
} ) );

const presetsOf = ( root: string ) => readWordPressSite( root, themePresetsFact );

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

	it( 'states nothing when WordPress cannot run, and asks it again next time', async () => {
		output = () => '';
		expect( await presetsOf( fixture.root ) ).toEqual( [] );
		output = () => JSON.stringify( resolved );
		expect( await presetsOf( fixture.root ) ).toHaveLength( 4 );
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
	}, 60000 );
} );
