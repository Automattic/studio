import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { holdsRules, themeStylesheet, withCode } from '@studio/agent/node/theme-stylesheet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { StudioAgentHost } from '@studio/agent/node';

it.each( [
	{ name: 'a header only', css: '/*\nTheme Name: Bakery\n*/\n', rules: false },
	{
		name: 'rules past the header',
		css: '/*\nTheme Name: Bakery\n*/\nbody { margin: 0 }',
		rules: true,
	},
] )( 'a stylesheet with $name', ( { css, rules } ) => {
	expect( holdsRules( css ) ).toBe( rules );
} );

it.each( [
	{ name: 'no functions.php', functions: undefined, result: '<?php\nCODE' },
	{ name: 'a file in PHP', functions: '<?php\nfoo();\n', result: '<?php\nfoo();\n\nCODE' },
	{
		name: 'a closing tag at the end',
		functions: '<?php\nfoo();\n?>\n',
		result: '<?php\nfoo();\n\nCODE',
	},
	{
		name: 'HTML at the end',
		functions: '<?php foo(); ?>\n<p>Hi</p>\n',
		result: '<?php foo(); ?>\n<p>Hi</p>\n\n<?php\nCODE',
	},
] )( 'adds code to $name', ( { functions, result } ) => {
	expect( withCode( functions, '\nCODE' ) ).toBe( result );
} );

// A real WordPress install to load stylesheets with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'the theme stylesheet, loaded by WordPress', () => {
	let root: string;
	const themes = () => path.join( root, 'wp-content', 'themes' );
	const site = () => liveSite( root, 'Site' );
	let host: StudioAgentHost;

	beforeEach( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'theme-stylesheet-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		host = liveHost( site() );
	} );
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	const theme = ( slug: string, files: Record< string, string | undefined > ) => {
		const dir = path.join( themes(), slug );
		mkdirSync( path.join( dir, 'templates' ), { recursive: true } );
		writeFileSync( path.join( dir, 'templates/index.html' ), '<!-- wp:post-content /-->' );
		for ( const [ file, content ] of Object.entries( files ) ) {
			writeFileSync( path.join( dir, file ), content ?? '' );
		}
	};
	const activate = async ( stylesheet: string, template = stylesheet ) => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		const set = db.prepare( 'UPDATE wp_options SET option_value = ? WHERE option_name = ?' );
		set.run( stylesheet, 'stylesheet' );
		set.run( template, 'template' );
		db.close();
	};
	// What the source reports when `change` makes a theme active.
	const settle = async ( change: () => Promise< void > ) => {
		const before = await themeStylesheet.read( root, undefined, host );
		await change();
		return themeStylesheet.check(
			site(),
			before,
			await themeStylesheet.read( root, undefined, host ),
			host
		);
	};
	const RULES = '/*\nTheme Name: Probe\n*/\nbody { margin: 0 }\n';

	it( 'adds the loading of a standalone theme’s style.css, as Twenty Twenty-Five does', async () => {
		theme( 'probe', { 'style.css': RULES } );
		const { reports, next } = await settle( () => activate( 'probe' ) );
		expect( reports.map( ( report ) => report.summary ) ).toEqual( [
			expect.stringContaining( 'did not reach the front end and the block editor' ),
		] );
		const functions = readFileSync( path.join( themes(), 'probe/functions.php' ), 'utf8' );
		expect( functions ).toContain( "get_parent_theme_file_uri( 'style.css' )" );
		expect( functions ).toContain( "add_editor_style( 'style.css' )" );
		// Studio's own change is the version compared next.
		expect( next ).toEqual( await themeStylesheet.read( root, undefined, host ) );
	} );

	it( 'adds only what a child theme lacks, with get_stylesheet_uri()', async () => {
		theme( 'probe-child', {
			'style.css': RULES.replace( '*/', 'Template: twentytwentyfive\n*/' ),
			'functions.php':
				"<?php\nadd_action( 'after_setup_theme', fn() => add_editor_style( 'style.css' ) );\n",
		} );
		const { reports } = await settle( () => activate( 'probe-child', 'twentytwentyfive' ) );
		expect( reports.map( ( report ) => report.summary ) ).toEqual( [
			expect.stringContaining( 'did not reach the front end.' ),
		] );
		const functions = readFileSync( path.join( themes(), 'probe-child/functions.php' ), 'utf8' );
		expect( functions ).toContain( 'get_stylesheet_uri()' );
		expect( functions.match( /add_editor_style/g ) ).toHaveLength( 1 );
	} );

	it( 'adds only the editor stylesheet to a theme that enqueues its style.css', async () => {
		theme( 'probe', {
			'style.css': RULES,
			'functions.php':
				"<?php\nadd_action( 'wp_enqueue_scripts', fn() => wp_enqueue_style( 'p', get_stylesheet_uri() ) );\n",
		} );
		const { reports } = await settle( () => activate( 'probe' ) );
		expect( reports.map( ( report ) => report.summary ) ).toEqual( [
			expect.stringContaining( 'did not reach the block editor.' ),
		] );
		const functions = readFileSync( path.join( themes(), 'probe/functions.php' ), 'utf8' );
		expect( functions.match( /wp_enqueue_style/g ) ).toHaveLength( 1 );
	} );

	it( 'says what still does not load when the theme already declares the functions', async () => {
		theme( 'probe', {
			'style.css': RULES,
			'functions.php':
				'<?php\nfunction probe_enqueue_styles() {}\nfunction probe_editor_style() {}\n',
		} );
		const { reports } = await settle( () => activate( 'probe' ) );
		expect( reports.map( ( report ) => report.problem ) ).toEqual( [
			expect.stringContaining( 'still do not reach the front end or the block editor' ),
		] );
	} );

	it.each( [
		{
			name: 'a theme that loads its style.css',
			slug: 'probe',
			files: {
				'style.css': RULES,
				'functions.php':
					"<?php\nadd_action( 'wp_enqueue_scripts', fn() => wp_enqueue_style( 'p', get_stylesheet_uri() ) );\nadd_action( 'after_setup_theme', fn() => add_editor_style( 'style.css' ) );\n",
			},
		},
		{
			name: 'a style.css with only its header',
			slug: 'probe',
			files: { 'style.css': '/*\nTheme Name: Probe\n*/' },
		},
		{ name: 'a theme WordPress updates', slug: 'twentytwentythree', files: { 'style.css': RULES } },
	] )( 'leaves $name as it is', async ( { slug, files } ) => {
		theme( slug, files );
		const { reports } = await settle( () => activate( slug ) );
		expect( reports ).toEqual( [] );
		expect( existsSync( path.join( themes(), slug, 'functions.php' ) ) ).toBe(
			'functions.php' in files
		);
	} );

	it( 'checks nothing while the active theme and its files stay as they are', async () => {
		theme( 'probe', { 'style.css': RULES } );
		await activate( 'probe' );
		const { reports } = await settle( async () => {} );
		expect( reports ).toEqual( [] );
		expect( existsSync( path.join( themes(), 'probe/functions.php' ) ) ).toBe( false );
	} );
} );
