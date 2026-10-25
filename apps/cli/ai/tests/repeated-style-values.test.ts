import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { repeatedStyleValueNotes, repeatedStyleValues } from 'cli/ai/repeated-style-values';
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

const paragraph = ( style: object ) =>
	`<!-- wp:paragraph ${ JSON.stringify( { style } ) } --><p>Roast</p><!-- /wp:paragraph -->`;
const times = ( n: number, block: string ) => Array( n ).fill( block ).join( '\n' );
const small = paragraph( { typography: { fontSize: '0.8rem' } } );

describe( 'repeatedStyleValues', () => {
	it.each( [
		{
			name: 'one raw value on three blocks',
			markup: times( 3, small ),
			repeated: [ { path: 'typography.fontSize', value: '0.8rem', blocks: 3 } ],
		},
		{ name: 'the same value on two blocks', markup: times( 2, small ), repeated: [] },
		{
			name: 'blocks nested in self-closing and wrapping blocks',
			markup: `<!-- wp:group {"style":{"spacing":{"padding":{"top":"7rem"}}}} --><div class="wp-block-group">${ times(
				2,
				'<!-- wp:separator {"style":{"spacing":{"padding":{"top":"7rem"}}}} /-->'
			) }</div><!-- /wp:group -->`,
			repeated: [ { path: 'spacing.padding.top', value: '7rem', blocks: 3 } ],
		},
		{
			name: 'a preset',
			markup: times( 3, paragraph( { spacing: { blockGap: 'var:preset|spacing|40' } } ) ),
			repeated: [],
		},
		{
			name: 'a CSS variable',
			markup: times( 3, paragraph( { spacing: { blockGap: 'var(--wp--style--block-gap)' } } ) ),
			repeated: [],
		},
		{
			name: 'zero',
			markup: times( 3, paragraph( { spacing: { margin: { top: '0px' } } } ) ),
			repeated: [],
		},
		{
			name: 'different values',
			markup: [ '0.8rem', '0.9rem', '1rem' ]
				.map( ( fontSize ) => paragraph( { typography: { fontSize } } ) )
				.join( '' ),
			repeated: [],
		},
		{
			name: 'the blocks after attributes that are not JSON',
			markup: '<!-- wp:paragraph {"style":} --><p></p><!-- /wp:paragraph -->\n' + times( 3, small ),
			repeated: [ { path: 'typography.fontSize', value: '0.8rem', blocks: 3 } ],
		},
	] )( '$name', ( { markup, repeated } ) => {
		expect( repeatedStyleValues( markup ) ).toEqual( repeated );
	} );
} );

// A real WordPress install whose presets the note names, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'repeatedStyleValueNotes', () => {
	let root: string;
	const write = ( relativePath: string, content: string ) => {
		const file = path.join( root, relativePath );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, content );
		return repeatedStyleValueNotes( resolveSiteFile( file )! );
	};
	beforeAll( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'repeated-style-values-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
	} );
	afterAll( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'names the raw values a template repeats, and the presets of their kind', async () => {
		const [ note, ...rest ] = await write(
			'wp-content/themes/twentytwentyfive/templates/front-page.html',
			times( 5, small ) + times( 3, paragraph( { typography: { fontStyle: 'italic' } } ) )
		);
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			'twentytwentyfive/templates/front-page.html sets the same raw style values on several blocks: typography.fontSize 0.8rem on 5.'
		);
		expect( note ).toMatch(
			/Font size presets \(wp_get_global_settings\(\)\), taken as "fontSize":"<slug>": small [^,]+, medium /
		);
		expect( note ).not.toContain( 'fontStyle' );
		expect( note ).not.toContain( 'Spacing size presets' );
	} );

	it( 'says when the site has no presets of a kind', async () => {
		await write( 'wp-content/themes/plain/style.css', '/*\nTheme Name: Plain\n*/' );
		await write( 'wp-content/themes/plain/templates/index.html', '' );
		await write(
			'wp-content/themes/plain/theme.json',
			JSON.stringify( { version: 3, settings: { spacing: { defaultSpacingSizes: false } } } )
		);
		await runWpCli( { id: 'site', name: 'Plain', path: root } as SiteData, [
			'theme',
			'activate',
			'plain',
		] );
		const [ note ] = await write(
			'wp-content/themes/plain/templates/index.html',
			times( 3, paragraph( { spacing: { blockGap: '2rem' } } ) )
		);
		expect( note ).toContain(
			'Spacing size presets (wp_get_global_settings()), taken as "var:preset|spacing|<slug>": none.'
		);
	} );

	it.each( [
		{
			name: 'markup without repeated values',
			file: 'wp-content/themes/twentytwentyfive/parts/footer.html',
			content: small,
		},
		{
			name: 'a file that is not block markup',
			file: 'wp-content/themes/twentytwentyfive/notes.txt',
			content: times( 3, small ).replace( /<!--/g, 'x <!--' ),
		},
		{
			name: 'a style no preset gives',
			file: 'wp-content/themes/twentytwentyfive/parts/footer.html',
			content: times( 3, paragraph( { typography: { letterSpacing: '2px' } } ) ),
		},
	] )( 'says nothing for $name', async ( { file, content } ) => {
		expect( await write( file, content ) ).toEqual( [] );
	} );
} );
