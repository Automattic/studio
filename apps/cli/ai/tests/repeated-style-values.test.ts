import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sitePresetValues, validateBlockMarkupFile } from 'cli/ai/block-validation-gate';
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

	// The notes where the block validation gate saves the file, and its save.
	const notes = ( file: string ) =>
		repeatedStyleValueNotes( resolveSiteFile( file )!, { gateSaves: true } );
	const saveThroughEditor = async ( file: string, theme: string ) => {
		const result = await validateBlockMarkupFile(
			file,
			EDITOR!,
			await sitePresetValues( root, theme )
		);
		writeFileSync( file, result.fixedContent! );
		return result.summary;
	};
	const HEADER = '<?php\n/**\n * Title: Cards\n * Slug: roast/cards\n */\n?>\n';

	it.each( [
		{
			name: 'a theme template',
			slug: 'studio-test-roast',
			header: '',
			fontSizes: undefined,
			file: 'templates/index.html',
			content: times( 3, sized ),
		},
		{
			name: "a child theme's pattern with its own font sizes, and its group missing its wrapper",
			slug: 'studio-test-roast-child',
			header: 'Template: twentytwentyfive\n',
			fontSizes: [ { slug: 'tiny', size: '10px', name: 'Tiny' } ],
			file: 'patterns/cards.php',
			content: `${ HEADER }<!-- wp:group -->\n${ times( 3, sized ) }\n<!-- /wp:group -->`,
		},
	] )(
		'makes the sizes $name repeats presets, which the save through the editor stores',
		async ( { slug, header, fontSizes, file, content } ) => {
			const dir = `wp-content/themes/${ slug }`;
			put( `${ dir }/style.css`, `/*\nTheme Name: ${ slug }\n${ header }*/\n` );
			const themeJson = put(
				`${ dir }/theme.json`,
				JSON.stringify( { version: 3, settings: { typography: { fontSizes } } } )
			);
			const written = put( `${ dir }/${ file }`, content );
			const [ note, ...rest ] = await notes( written );

			expect( rest ).toEqual( [] );
			expect( note ).toContain( `it added size-1-4-rem (1.4rem) to ${ themeJson }` );
			expect(
				JSON.parse( readFileSync( themeJson, 'utf8' ) ).settings.typography.fontSizes
			).toEqual( [
				...( fontSizes ?? [] ),
				{ name: '1.4rem', slug: 'size-1-4-rem', size: '1.4rem' },
			] );
			expect( await saveThroughEditor( written, slug ) ).toContain(
				'stores 1.4rem as the font size size-1-4-rem'
			);
			const saved = readFileSync( written, 'utf8' );
			expect( saved.startsWith( content.slice( 0, content.indexOf( '<!--' ) ) ) ).toBe( true );
			expect( saved ).not.toContain( '1.4rem' );
			expect( saved.match( /"fontSize":"size-1-4-rem"/g ) ).toHaveLength( 3 );
			const markup = saved.slice( saved.indexOf( '<!--' ) );
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
				`echo wp_get_global_stylesheet( array( 'variables', 'presets' ) ), do_blocks( ${ JSON.stringify(
					markup
				) } );`,
			] );
			expect( rendered ).toContain( `--wp--preset--font-size--size-1-4-rem: ${ size };` );
			expect( rendered ).toContain( 'has-size-1-4-rem-font-size' );
		},
		120000
	);

	// As run 37's 01a17832-e931 wrote its cards: the same raw padding and gap on each.
	it( 'makes the spacing a template repeats presets, which the save through the editor stores', async () => {
		const slug = 'studio-test-roast-spacing';
		const dir = `wp-content/themes/${ slug }`;
		// A font size with !important leaves spacing as it renders.
		put(
			`${ dir }/style.css`,
			`/*\nTheme Name: ${ slug }\n*/\np { font-size: 1rem !important; }\n`
		);
		const themeJson = put( `${ dir }/theme.json`, JSON.stringify( { version: 3 } ) );
		const card =
			'<!-- wp:group {"style":{"spacing":{"padding":{"left":"2rem","right":"2rem"},"blockGap":"0.6rem"}}} -->\n<div class="wp-block-group" style="padding-right:2rem;padding-left:2rem"></div>\n<!-- /wp:group -->';
		const written = put( `${ dir }/templates/index.html`, times( 3, card ) );
		const [ note, ...rest ] = await notes( written );

		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			`Studio made the spacing sizes ${ written } repeats spacing size presets of ${ slug }: it added size-2-rem (2rem), size-0-6-rem (0.6rem) to ${ themeJson }'s "settings": { "spacing": { "spacingSizes" } }`
		);
		expect( await saveThroughEditor( written, slug ) ).toContain(
			'stores 2rem as the spacing size size-2-rem, 0.6rem as the spacing size size-0-6-rem'
		);
		const saved = readFileSync( written, 'utf8' );
		expect( saved ).not.toMatch( /"(2|0\.6)rem"/ );
		expect( saved.match( /var:preset\|spacing\|size-2-rem/g ) ).toHaveLength( 6 );
		expect( ( await validateBlocks( saved, EDITOR! ) ).invalidBlocks ).toBe( 0 );

		// WordPress renders each preset's variable as the value it replaced.
		await runWpCli( site(), [ 'theme', 'activate', slug ] );
		const rendered = await runWpCli( site(), [
			'eval',
			`echo wp_get_global_stylesheet( array( 'variables' ) ), do_blocks( ${ JSON.stringify(
				saved
			) } );`,
		] );
		expect( rendered ).toContain( '--wp--preset--spacing--size-2-rem: 2rem;' );
		expect( rendered ).toContain( '--wp--preset--spacing--size-0-6-rem: 0.6rem;' );
		expect( rendered ).toContain( 'padding-left:var(--wp--preset--spacing--size-2-rem)' );
	}, 120000 );

	it( 'notes the sizes and adds no preset where no gate saves the file', async () => {
		const dir = 'wp-content/themes/studio-test-ungated';
		put( `${ dir }/style.css`, '/*\nTheme Name: Ungated\n*/' );
		const json = JSON.stringify( {
			version: 3,
			settings: { typography: { fontSizes: [ { slug: 'roast', size: '2rem', name: 'Roast' } ] } },
		} );
		const themeJson = put( `${ dir }/theme.json`, json );
		const preset = paragraph( { typography: { fontSize: '2rem' } } );
		const template = put( `${ dir }/templates/index.html`, times( 3, sized ) + times( 3, preset ) );
		const [ note, ...rest ] = await repeatedStyleValueNotes( resolveSiteFile( template )! );
		expect( rest ).toEqual( [] );
		expect( note ).toContain( 'typography.fontSize 1.4rem on 3, typography.fontSize 2rem on 3.' );
		expect( readFileSync( themeJson, 'utf8' ) ).toBe( json );
	}, 60000 );

	it( 'notes the sizes of a pattern that holds PHP, which no gate saves', async () => {
		const dir = 'wp-content/themes/studio-test-php-pattern';
		put( `${ dir }/style.css`, '/*\nTheme Name: PHP pattern\n*/' );
		const themeJson = put( `${ dir }/theme.json`, '{"version":3}' );
		const pattern = put(
			`${ dir }/patterns/cards.php`,
			`${ HEADER }${ times( 3, sized ) }<p><?php echo esc_html( 'Roast' ); ?></p>`
		);
		const [ note ] = await notes( pattern );
		expect( note ).toContain( 'typography.fontSize 1.4rem on 3.' );
		expect( readFileSync( themeJson, 'utf8' ) ).toBe( '{"version":3}' );
	}, 60000 );

	it( 'leaves a value a preset has to the save through the editor, which stores it as the preset', async () => {
		const dir = 'wp-content/themes/studio-test-preset';
		put( `${ dir }/style.css`, '/*\nTheme Name: Preset\n*/' );
		const json = JSON.stringify( {
			version: 3,
			settings: {
				typography: { fontSizes: [ { slug: 'roast', size: '1.4rem', name: 'Roast' } ] },
				spacing: { spacingSizes: [ { slug: 'gap', size: '2.5rem', name: 'Gap' } ] },
			},
		} );
		const themeJson = put( `${ dir }/theme.json`, json );
		const gap = paragraph( { spacing: { padding: { top: '2.5rem' } } } );
		const template = put( `${ dir }/templates/index.html`, times( 3, sized ) + times( 3, gap ) );
		expect( await notes( template ) ).toEqual( [] );
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
		const [ note, sizes, spacing, ...rest ] = await notes( template );
		expect( rest ).toEqual( [] );
		expect( note ).toContain(
			'sets the same raw style values on several blocks: typography.fontSize clamp(1rem, 2vw, 2rem) on 3.'
		);
		expect( sizes ).toContain( 'it added size-1-4-rem (1.4rem)' );
		expect( spacing ).toContain( 'it added size-2-5-rem (2.5rem)' );
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
			const [ note ] = await notes( template );
			expect( note ).toContain(
				'sets the same raw style values on several blocks: typography.fontSize 1.4rem on 3.'
			);
			expect( readFileSync( themeJson, 'utf8' ) ).toBe( json );
			expect( readFileSync( template, 'utf8' ) ).toBe( times( 3, sized ) );
		},
		60000
	);
} );
