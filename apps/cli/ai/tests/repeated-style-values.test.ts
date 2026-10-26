import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupValidatorPages, validateBlocks } from 'cli/ai/block-validator';
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
// Its block editor is the one the given URL serves.
const EDITOR = process.env.STUDIO_BLOCK_EDITOR_URL;
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: async () => ( {} ),
	getSiteUrl: () => process.env.STUDIO_BLOCK_EDITOR_URL ?? 'http://localhost:9',
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

	it( "names the presets of the file's theme, active or not", async () => {
		// The theme being built while Twenty Twenty-Five is still active.
		await write( 'wp-content/themes/studio-test-ember/style.css', '/*\nTheme Name: Ember\n*/' );
		await write(
			'wp-content/themes/studio-test-ember/theme.json',
			JSON.stringify( {
				version: 3,
				settings: {
					typography: {
						defaultFontSizes: false,
						fontSizes: [ { slug: 'ember-small', size: '13px', name: 'Small' } ],
					},
				},
			} )
		);
		const [ note ] = await write(
			'wp-content/themes/studio-test-ember/templates/front-page.html',
			times( 3, paragraph( { typography: { fontSize: 'clamp(1rem, 2vw, 2rem)' } } ) )
		);
		expect( note ).toContain( 'taken as "fontSize":"<slug>": ember-small 13px.' );
	}, 60000 );

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

describe.runIf( WORDPRESS && EDITOR )( 'repeated raw font sizes made presets', () => {
	let root: string;
	let kept = 0;
	const site = () => ( { id: 'site', name: 'Ember Roasters', path: root } ) as SiteData;
	const put = ( relativePath: string, content: string ) => {
		const file = path.join( root, relativePath );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, content );
		return file;
	};
	const sized = paragraph( { typography: { fontSize: '1.4rem' } } ).replace(
		'<p>',
		'<p style="font-size:1.4rem">'
	);
	beforeAll( () => {
		root = mkdtempSync( path.join( os.tmpdir(), 'repeated-font-sizes-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
	} );
	afterAll( async () => {
		await cleanupValidatorPages();
		rmSync( root, { recursive: true, force: true } );
	} );
	// The themes are none WordPress.org has.
	beforeEach( () =>
		vi.stubGlobal( 'fetch', async () => Response.json( { themes: {}, no_update: {} } ) )
	);
	afterEach( () => vi.unstubAllGlobals() );

	it.each( [
		{ name: 'a theme', slug: 'studio-test-roast', header: '', fontSizes: undefined, css: '' },
		{
			name: 'a child theme with its own font sizes',
			slug: 'studio-test-roast-child',
			header: 'Template: twentytwentyfive\n',
			fontSizes: [ { slug: 'tiny', size: '10px', name: 'Tiny' } ],
			css: '',
		},
	] )(
		'makes the sizes $name repeats its presets',
		async ( { slug, header, fontSizes, css } ) => {
			const dir = `wp-content/themes/${ slug }`;
			put( `${ dir }/style.css`, `/*\nTheme Name: ${ slug }\n${ header }*/\n${ css }` );
			const themeJson = put(
				`${ dir }/theme.json`,
				JSON.stringify( { version: 3, settings: { typography: { fontSizes } } } )
			);
			const template = put( `${ dir }/templates/index.html`, times( 3, sized ) );
			const [ note, ...rest ] = await repeatedStyleValueNotes( resolveSiteFile( template )! );

			expect( rest ).toEqual( [] );
			expect( note ).toContain( `it added size-1-4-rem (1.4rem) to ${ themeJson }` );
			expect( note ).toContain( 'set 3 block(s) to "fontSize":"size-1-4-rem"' );
			expect(
				JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontSizes
			).toEqual( [
				...( fontSizes ?? [] ),
				{ name: '1.4rem', slug: 'size-1-4-rem', size: '1.4rem' },
			] );
			const markup = readFileSync( template, 'utf8' );
			expect( markup ).not.toContain( '1.4rem' );
			expect( markup.match( /"fontSize":"size-1-4-rem"/g ) ).toHaveLength( 3 );
			expect( ( await validateBlocks( markup, EDITOR! ) ).invalidBlocks ).toBe( 0 );

			// WordPress renders the preset at the size it rendered the raw value at,
			// fluid where the theme's typography is.
			await runWpCli( site(), [ 'theme', 'activate', slug ] );
			const raw = await runWpCli( site(), [
				'eval',
				`echo do_blocks( ${ JSON.stringify( sized ) } );`,
			] );
			const size = raw.match( /font-size:([^;"]+)/ )?.[ 1 ];
			expect( size ).toBeDefined();
			const rendered = await runWpCli( site(), [
				'eval',
				`echo wp_get_global_stylesheet( array( 'variables', 'presets' ) ), do_blocks( file_get_contents( '${ template }' ) );`,
			] );
			expect( rendered ).toContain( `--wp--preset--font-size--size-1-4-rem: ${ size };` );
			expect( rendered ).toContain( 'has-size-1-4-rem-font-size' );
		},
		120000
	);

	it( 'leaves a size a preset has to the save through the editor, which stores it as the preset', async () => {
		const dir = 'wp-content/themes/studio-test-preset';
		put( `${ dir }/style.css`, '/*\nTheme Name: Preset\n*/' );
		const json = JSON.stringify( {
			version: 3,
			settings: { typography: { fontSizes: [ { slug: 'roast', size: '1.4rem', name: 'Roast' } ] } },
		} );
		const themeJson = put( `${ dir }/theme.json`, json );
		const template = put( `${ dir }/templates/index.html`, times( 3, sized ) );
		expect( await repeatedStyleValueNotes( resolveSiteFile( template )! ) ).toEqual( [] );
		expect( readFileSync( themeJson, 'utf8' ) ).toBe( json );
	}, 60000 );

	it( 'notes what it does not make a preset beside what it does', async () => {
		const dir = 'wp-content/themes/studio-test-both';
		put( `${ dir }/style.css`, '/*\nTheme Name: Both\n*/' );
		put( `${ dir }/theme.json`, '{"version":3}' );
		const gap = paragraph( { spacing: { padding: { top: '2.5rem' } } } ).replace(
			'<p>',
			'<p style="padding-top:2.5rem">'
		);
		const fluid = paragraph( { typography: { fontSize: 'clamp(1rem, 2vw, 2rem)' } } );
		const template = put(
			`${ dir }/templates/index.html`,
			times( 3, sized ) + times( 3, gap ) + times( 3, fluid )
		);
		const [ note, made, ...rest ] = await repeatedStyleValueNotes( resolveSiteFile( template )! );
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			'sets the same raw style values on several blocks: typography.fontSize clamp(1rem, 2vw, 2rem) on 3, spacing.padding.top 2.5rem on 3.'
		);
		expect( made ).toContain( 'it added size-1-4-rem (1.4rem)' );
	}, 60000 );

	it.each( [
		{
			name: "a child theme without its own font sizes, whose list would replace its parent's list",
			header: 'Template: twentytwentyfive\n',
			css: '',
		},
		{
			name: 'a theme whose CSS sets a font size with !important',
			header: '',
			css: '.wp-block-paragraph { font-size: 1rem !important; }',
		},
		{
			name: 'a theme with a preset of the slug for another size',
			header: '',
			css: '',
			json: '{"version":3,"settings":{"typography":{"fontSizes":[{"slug":"size-1-4-rem","size":"2rem","name":"Big"}]}}}',
		},
	] )(
		'notes the sizes of $name',
		async ( { header, css, json = '{"version":3}' } ) => {
			const dir = `wp-content/themes/studio-test-kept-${ ++kept }`;
			put( `${ dir }/style.css`, `/*\nTheme Name: Kept\n${ header }*/\n${ css }` );
			const themeJson = put( `${ dir }/theme.json`, json );
			const template = put( `${ dir }/templates/index.html`, times( 3, sized ) );
			const [ note ] = await repeatedStyleValueNotes( resolveSiteFile( template )! );
			expect( note ).toContain(
				'sets the same raw style values on several blocks: typography.fontSize 1.4rem on 3.'
			);
			expect( readFileSync( themeJson, 'utf8' ) ).toBe( json );
			expect( readFileSync( template, 'utf8' ) ).toBe( times( 3, sized ) );
		},
		60000
	);
} );
