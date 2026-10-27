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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	blockClassCounts,
	classProperties,
	createSharedBlockClassNotes,
} from 'cli/ai/shared-block-classes';
import { resolveSiteFile } from 'cli/ai/site-file-guards';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
// The copy of WordPress the tests write to is not one of Studio's sites.
vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: async ( root: string ) => ( { id: 'site', name: 'Ember Roasters', path: root } ),
} ) );

// A block whose element lacks the class, so Studio has no element to add a
// block style to, and says where one goes instead.
const block = ( name: string, className: string ) =>
	`<!-- wp:${ name } ${ JSON.stringify( { className } ) } --><div></div><!-- /wp:${ name } -->`;
const times = ( n: number, markup: string ) => Array( n ).fill( markup ).join( '\n' );

describe( 'blockClassCounts', () => {
	it.each( [
		{
			name: 'each class of each block, by block type',
			markup: [
				times( 2, block( 'column', 'card lift' ) ) + block( 'group', 'card' ),
				block( 'column', 'card' ),
			],
			counts: { card: { 'core/column': 3, 'core/group': 1 }, lift: { 'core/column': 2 } },
		},
		{
			name: 'a plugin block by its namespace',
			markup: [ block( 'jetpack/slideshow', 'framed' ) ],
			counts: { framed: { 'jetpack/slideshow': 1 } },
		},
		{
			name: 'a self-closing block',
			markup: [ '<!-- wp:separator {"className":"rule"} /-->' ],
			counts: { rule: { 'core/separator': 1 } },
		},
		{
			name: 'a block style class aside',
			markup: [ block( 'group', 'is-style-card' ) ],
			counts: {},
		},
		{ name: 'invalid attributes', markup: [ '<!-- wp:group {"className":} -->' ], counts: {} },
	] )( '$name', ( { markup, counts } ) => {
		const found = Object.fromEntries(
			[ ...blockClassCounts( markup ) ].map( ( [ name, types ] ) => [
				name,
				Object.fromEntries( types ),
			] )
		);
		expect( found ).toEqual( counts );
	} );
} );

describe( 'classProperties', () => {
	it.each( [
		{
			name: 'a rule of the class',
			css: '.card { background: #fff; border-radius: 8px }',
			properties: { card: [ 'background', 'border-radius' ] },
		},
		{
			name: 'its states and a selector list',
			css: '.card:hover, .tile { Box-Shadow: none; } /* .note { color: red } */',
			properties: { card: [ 'box-shadow' ], tile: [ 'box-shadow' ] },
		},
		{
			name: "the class beside a block's class",
			css: '.wp-block-group.card { padding: 1rem } .card.wp-block-group { color: red } .wp-block-group .tile { color: red }',
			properties: { card: [ 'padding', 'color' ] },
		},
		{
			name: 'a rule for what is inside the class, or the class on an element',
			css: '.card h3 { color: red } div.card { color: red } .card > p { color: red }',
			properties: {},
		},
	] )( '$name', ( { css, properties } ) => {
		const found = Object.fromEntries(
			[ ...classProperties( css ) ].map( ( [ name, set ] ) => [ name, [ ...set ] ] )
		);
		expect( found ).toEqual( properties );
	} );
} );

const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'createSharedBlockClassNotes', () => {
	let root: string;
	const notes = createSharedBlockClassNotes();
	// A slug WordPress.org has no theme of, so Studio may write to it.
	const theme = 'wp-content/themes/studio-test-ember';
	const write = ( relativePath: string, content: string ) => {
		const file = path.join( root, theme, relativePath );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, content );
		return notes( resolveSiteFile( file )! );
	};
	const site = () => ( { id: 'site', name: 'Ember Roasters', path: root } ) as SiteData;
	beforeAll( async () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'shared-block-classes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		mkdirSync( path.join( root, theme, 'templates' ), { recursive: true } );
		writeFileSync( path.join( root, theme, 'templates', 'index.html' ), '' );
		writeFileSync( path.join( root, theme, 'theme.json' ), '{"version":3}' );
		writeFileSync( path.join( root, theme, 'style.css' ), '/*\nTheme Name: Ember\n*/' );
		await runWpCli( site(), [ 'theme', 'activate', 'studio-test-ember' ] );
	} );
	afterAll( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'names the classes the stylesheet gives a look on blocks of one type, and where a block style holds it', async () => {
		await write(
			'templates/front-page.html',
			times( 3, block( 'column', 'card' ) ) +
				times( 3, block( 'group', 'cell' ) ) +
				times( 2, block( 'paragraph', 'eyebrow' ) )
		);
		const [ note, ...rest ] = await write(
			'assets/css/theme.css',
			'.card { background: #fff; border-radius: 8px; box-shadow: 0 1px 2px #0003; transition: transform .2s }\n' +
				'.cell { grid-column: span 2; padding: 1rem; min-height: 10rem }\n' +
				'.eyebrow { color: #a33 }'
		);
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			"The theme's stylesheets give a look to classes that several blocks of one type carry: `.card` on 3 core/column (background, border-radius, box-shadow)."
		);
		expect( note ).toContain( `${ path.join( root, theme, 'styles', 'blocks' ) }/<slug>.json` );
		expect( note ).toContain(
			'background color.gradient, border-radius border.radius, box-shadow shadow'
		);
		expect( note ).toContain( '"className":"is-style-<slug>"' );
		expect( note ).toContain(
			'shadow; anything else goes in "styles": { "css" } (WP_Theme_JSON::process_blocks_custom_css()), where `&` stands for the block.'
		);
		expect( note ).not.toContain( '.cell' );
		expect( note ).not.toContain( '.eyebrow' );
	} );

	it( 'says each class once, and a class once it reaches enough blocks', async () => {
		expect(
			await write( 'assets/css/theme.css', '.card { background: #fff }\n.eyebrow { color: #a33 }' )
		).toEqual( [] );
		const [ note ] = await write( 'parts/footer.html', block( 'paragraph', 'eyebrow' ) );
		expect( note ).toContain( 'carry: `.eyebrow` on 3 core/paragraph (color).' );
		expect( note ).not.toContain( '.card' );
	} );

	it( 'counts the blocks of saved posts', async () => {
		await runWpCli( site(), [
			'post',
			'create',
			'--post_status=publish',
			`--post_content=${ times( 3, block( 'heading', 'kicker' ) ) }`,
		] );
		const [ note ] = await write(
			'style.css',
			'/*\nTheme Name: Ember\n*/\n.kicker { letter-spacing: .1em }'
		);
		expect( note ).toContain( 'carry: `.kicker` on 3 core/heading (letter-spacing).' );
	} );

	it( 'reads the CSS theme.json holds', async () => {
		writeFileSync(
			path.join( root, theme, 'templates', 'archive.html' ),
			times( 3, block( 'group', 'feature-card' ) )
		);
		const [ note ] = await write(
			'theme.json',
			JSON.stringify( {
				version: 3,
				styles: { css: '.feature-card { border-radius: 1rem; box-shadow: 0 8px 24px #0002 }' },
			} )
		);
		expect( note ).toContain(
			'carry: `.feature-card` on 3 core/group (border-radius, box-shadow).'
		);
	} );

	it( 'says nothing on a write outside the stylesheets and block markup', async () => {
		writeFileSync(
			path.join( root, theme, 'templates', 'single.html' ),
			times( 3, block( 'button', 'badge' ) )
		);
		writeFileSync(
			path.join( root, theme, 'assets', 'css', 'badge.css' ),
			'.badge { color: red }'
		);
		expect( await write( 'notes.txt', 'Badges' ) ).toEqual( [] );
		const [ note ] = await write( 'assets/css/badge.css', '.badge { color: red }' );
		expect( note ).toContain( 'carry: `.badge` on 3 core/button (color).' );
	} );

	it( 'moves a look it can move as it renders into a block style, which WordPress registers and prints', async () => {
		const card = ( name: string, tag: string ) =>
			`<!-- wp:${ name } {"className":"feature"} -->\n<${ tag } class="wp-block-${ name } feature"><p>x</p></${ tag }>\n<!-- /wp:${ name } -->`;
		const template = path.join( root, theme, 'templates', 'home.html' );
		writeFileSync( template, times( 3, card( 'group', 'div' ) ) );
		const output = await runWpCli( site(), [
			'post',
			'create',
			'--post_status=publish',
			'--porcelain',
			`--post_content=${ card( 'column', 'div' ) }`,
		] );
		const post = output.trim().split( /\s+/ ).pop();
		const [ note, ...rest ] = await write(
			'assets/css/feature.css',
			'.feature { background-color: #fff; border-radius: 8px }\n.feature:hover { box-shadow: 0 1px 2px #0003 }\n.feature h3 { margin: 0 }\n'
		);
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			'Studio moved the look `.feature` gives core/group, core/column blocks into a block style'
		);
		expect( note ).toContain( `${ path.join( root, theme, 'styles', 'blocks', 'feature.json' ) }` );
		expect( readFileSync( path.join( root, theme, 'assets', 'css', 'feature.css' ), 'utf8' ) ).toBe(
			'.feature h3 { margin: 0 }\n'
		);
		expect(
			readFileSync( template, 'utf8' ).split(
				'{"className":"feature is-style-feature"} -->\n<div class="wp-block-group feature is-style-feature">'
			)
		).toHaveLength( 4 );
		const wordpress = await runWpCli( site(), [
			'eval',
			`// WordPress prints a block style's CSS for each block it renders with it
// (wp_render_block_style_variation_support_styles() in wp-includes/block-supports/block-style-variations.php).
do_blocks( get_post( ${ post } )->post_content );
$css = wp_styles()->get_data( 'block-style-variation-styles', 'after' );
$css = is_array( $css ) ? implode( '', $css ) : '';
$registry = WP_Block_Styles_Registry::get_instance();
echo wp_json_encode( array(
	'registered' => $registry->is_registered( 'core/column', 'feature' ) && $registry->is_registered( 'core/group', 'feature' ),
	'post' => get_post( ${ post } )->post_content,
	'css' => $css,
) );`,
		] );
		const result = JSON.parse( wordpress.slice( wordpress.indexOf( '{' ) ) );
		expect( result.registered ).toBe( true );
		expect( result.post ).toContain( '"className":"feature is-style-feature"' );
		expect( result.post ).toContain( 'class="wp-block-column feature is-style-feature"' );
		expect( result.css ).toBe(
			':root :where(.wp-block-column.is-style-feature--1){background-color: #fff; border-radius: 8px;}:root :where(.wp-block-column.is-style-feature--1:hover ){box-shadow: 0 1px 2px #0003;}'
		);
	}, 60000 );

	// As run 52's 01a1…13710 styled its three feature cards, which no note named.
	it( "moves a look the stylesheet gives the class beside its blocks' class", async () => {
		const template = path.join( root, theme, 'templates', 'page.html' );
		writeFileSync(
			template,
			times(
				3,
				'<!-- wp:group {"className":"perk"} -->\n<div class="wp-block-group perk"><p>x</p></div>\n<!-- /wp:group -->'
			)
		);
		const [ note, ...rest ] = await write(
			'assets/css/perk.css',
			'.wp-block-group.perk { background-color: #fff; border-radius: 20px }\n.wp-block-group.perk .eyebrow { margin: 0 }\n'
		);
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			'Studio moved the look `.perk` gives core/group blocks into a block style'
		);
		expect(
			JSON.parse(
				readFileSync( path.join( root, theme, 'styles', 'blocks', 'perk.json' ), 'utf8' )
			)
		).toMatchObject( {
			blockTypes: [ 'core/group' ],
			styles: { css: 'background-color: #fff; border-radius: 20px;' },
		} );
		expect( readFileSync( path.join( root, theme, 'assets', 'css', 'perk.css' ), 'utf8' ) ).toBe(
			'.wp-block-group.perk .eyebrow { margin: 0 }\n'
		);
		expect(
			readFileSync( template, 'utf8' ).split( 'class="wp-block-group perk is-style-perk"' )
		).toHaveLength( 4 );
	}, 60000 );

	// As run 53's 01a1…36132 aligned its feature cards on small screens.
	it( 'moves what no media query also sets, and keeps the rest beside the class', async () => {
		const template = path.join( root, theme, 'templates', 'single.html' );
		writeFileSync(
			template,
			times(
				3,
				'<!-- wp:group {"className":"perk-row"} -->\n<div class="wp-block-group perk-row"><p>x</p></div>\n<!-- /wp:group -->'
			)
		);
		const [ note ] = await write(
			'assets/css/perk-row.css',
			'.perk-row {\n\tbox-shadow: 0 1px 2px #0003;\n\talign-items: flex-start;\n}\n@media (max-width: 781px) {\n\t.perk-row { align-items: center; }\n}\n'
		);
		expect( note ).toContain( 'Studio moved the look `.perk-row` gives core/group blocks' );
		expect( note ).toContain( "the class's rules keep align-items" );
		expect(
			JSON.parse(
				readFileSync( path.join( root, theme, 'styles', 'blocks', 'perk-row.json' ), 'utf8' )
			).styles
		).toEqual( { css: 'box-shadow: 0 1px 2px #0003;' } );
		expect(
			readFileSync( path.join( root, theme, 'assets', 'css', 'perk-row.css' ), 'utf8' )
		).toBe(
			'.perk-row {\n\talign-items: flex-start;\n}\n@media (max-width: 781px) {\n\t.perk-row { align-items: center; }\n}\n'
		);
	}, 60000 );

	// Each case sets up, beside three blocks that could take the style, what
	// keeps Studio from moving the look, and returns what undoes it.
	const themeFile = ( file: string, content: string ) => {
		const at = path.join( root, theme, file );
		const before = existsSync( at ) ? readFileSync( at, 'utf8' ) : undefined;
		mkdirSync( path.dirname( at ), { recursive: true } );
		writeFileSync( at, content );
		return () => ( before === undefined ? rmSync( at ) : writeFileSync( at, before ) );
	};
	it.each( [
		{
			name: 'an element outside a block carries it',
			slug: 'tile',
			setUp: async ( slug: string ) =>
				themeFile(
					'templates/archive.html',
					`<!-- wp:html --><div class="${ slug }">x</div><!-- /wp:html -->`
				),
		},
		{
			name: "another theme file's code names it",
			slug: 'ribbon',
			setUp: async ( slug: string ) =>
				themeFile(
					'functions.php',
					`<?php add_filter( 'body_class', fn ( $c ) => [ ...$c, '${ slug }' ] );`
				),
		},
		{
			name: 'the theme has a block style of its name',
			slug: 'stamp',
			setUp: async ( slug: string ) =>
				themeFile(
					`styles/blocks/${ slug }.json`,
					'{"version":3,"title":"Stamp","blockTypes":["core/group"],"styles":{"color":{"text":"red"}}}'
				),
		},
		{
			name: "theme.json's CSS styles it",
			slug: 'chip',
			setUp: async ( slug: string ) =>
				themeFile(
					'theme.json',
					JSON.stringify( { version: 3, styles: { css: `.${ slug } { color: red }` } } )
				),
		},
		{
			name: 'Additional CSS the site saved styles it',
			slug: 'flag',
			setUp: async ( slug: string ) => {
				const output = await runWpCli( site(), [
					'post',
					'create',
					'--post_type=custom_css',
					'--post_status=publish',
					'--post_title=studio-test-ember',
					'--porcelain',
					`--post_content=.${ slug } { color: red }`,
				] );
				const id = output.trim().split( /\s+/ ).pop()!;
				return () => runWpCli( site(), [ 'post', 'delete', id, '--force' ] );
			},
		},
	] )(
		'leaves a look in the stylesheet, and says where it goes, when $name',
		async ( { slug, setUp } ) => {
			const undo = await setUp( slug );
			try {
				const template = path.join( root, theme, 'templates', `${ slug }.html` );
				const blocks = times(
					3,
					`<!-- wp:group {"className":"${ slug }"} --><div class="wp-block-group ${ slug }"></div><!-- /wp:group -->`
				);
				writeFileSync( template, blocks );
				const css = `.${ slug } { background-color: #eee }\n`;
				const notes = await write( `assets/css/${ slug }.css`, css );
				expect( notes.join( '\n' ) ).toContain( `\`.${ slug }\` on 3 core/group (` );
				expect( notes.join( '\n' ) ).not.toContain( 'Studio moved' );
				expect( readFileSync( template, 'utf8' ) ).toBe( blocks );
				expect(
					readFileSync( path.join( root, theme, 'assets', 'css', `${ slug }.css` ), 'utf8' )
				).toBe( css );
			} finally {
				await undo();
				rmSync( path.join( root, theme, 'templates', `${ slug }.html` ) );
				rmSync( path.join( root, theme, 'assets', 'css', `${ slug }.css` ) );
			}
		},
		60000
	);
} );
