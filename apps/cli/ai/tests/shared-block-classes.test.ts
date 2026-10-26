import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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
	const theme = 'wp-content/themes/ember';
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
		await runWpCli( site(), [ 'theme', 'activate', 'ember' ] );
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
		expect( note ).toContain( 'shadow; anything else goes in its "css".' );
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
} );
