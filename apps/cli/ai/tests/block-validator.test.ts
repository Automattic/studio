import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	bindNavigationLinks,
	cleanupValidatorPages,
	dropCommentsBetweenBlocks,
	insertedTemplates,
	storePaletteColors,
	validateBlocks,
} from 'cli/ai/block-validator';
import { getSharedBrowser } from 'cli/ai/browser-utils';

// Runs the site's own block editor, so it needs a running WordPress site:
// STUDIO_BLOCK_EDITOR_URL=http://localhost:8881 npx vitest run block-validator
const siteUrl = process.env.STUDIO_BLOCK_EDITOR_URL;
// The same site's folder, for cases that add a plugin to it.
const sitePath = process.env.STUDIO_BLOCK_EDITOR_PATH;

const group = ( attrs: string, inner: string ) =>
	`<!-- wp:group ${ attrs } -->\n${ inner }\n<!-- /wp:group -->`;
const paragraph = ( attrs: string, html: string ) =>
	`<!-- wp:paragraph ${ attrs } -->\n${ html }\n<!-- /wp:paragraph -->`;

describe.runIf( siteUrl )( 'validating in the block editor (live)', () => {
	afterAll( cleanupValidatorPages );

	it.each( [
		{
			name: 'a group written without its wrapper keeps its classes',
			markup: group(
				'{"className":"grid"}',
				group( '{"className":"cell"}', paragraph( '{}', '<p>Fast &mdash; always</p>' ) )
			),
			fixed: [ '<div class="wp-block-group grid"><!-- wp:group {"className":"cell"}' ],
		},
		{
			name: 'an image keeps the size its comment names',
			markup: group(
				'{}',
				'<!-- wp:image {"sizeSlug":"large"} -->\n<figure class="wp-block-image"><img src="https://example.com/a.png" alt=""/></figure>\n<!-- /wp:image -->'
			),
			fixed: [ '"sizeSlug":"large"', 'size-large' ],
		},
		{
			name: 'a block an older version accepts is saved as the current version',
			markup: paragraph(
				'{"className":"eyebrow","style":{"typography":{"fontWeight":"700"}},"textColor":"red","fontSize":"small"}',
				'<p class="eyebrow has-red-color has-small-font-size" style="font-weight:700">Eyebrow</p>'
			),
			fixed: [
				'<p class="eyebrow has-red-color has-text-color has-small-font-size" style="font-weight:700">Eyebrow</p>',
			],
		},
		{
			name: "a paragraph's textAlign moves to where WordPress 7.0 reads it",
			markup: paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ),
			fixed: [ '{"style":{"typography":{"textAlign":"center"}}}', 'has-text-align-center' ],
		},
		{
			name: "an attribute at the block's default is kept",
			markup: group(
				'{}',
				'<!-- wp:site-title {"level":1} /-->\n<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->'
			),
			fixed: [ '<div class="wp-block-group"><!-- wp:site-title /-->' ],
		},
	] )(
		'$name',
		async ( { markup, fixed } ) => {
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.error ).toBeUndefined();
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
			expect( report.proposedFix?.losses ).toEqual( [] );
			for ( const text of fixed ) {
				expect( report.proposedFix?.fixedContent ).toContain( text );
			}
		},
		60_000
	);

	const cover = ( html: string ) =>
		`<!-- wp:cover {"minHeight":"100dvh"} -->\n${ html }\n<!-- /wp:cover -->`;
	const coverIssue = 'core/cover\'s "minHeight" is of type number, so WordPress ignores "100dvh".';

	it.each( [
		{
			name: 'leaves it out of the fix',
			markup: cover(
				'<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>'
			),
			issue: coverIssue,
			losses: [],
		},
		{
			name: 'keeps the block as written when it renders the value too',
			markup: cover(
				'<div class="wp-block-cover" style="min-height:100dvh"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>'
			),
			issue: coverIssue,
			losses: [
				{ place: '/0', blockName: 'core/cover', lost: 'drop the styles min-height:100dvh' },
			],
		},
		{
			name: 'leaves a value the block markup does not hold out of the fix',
			markup:
				'<!-- wp:columns {"verticalAlignment":null} -->\n<div class="wp-block-columns alignwide"></div>\n<!-- /wp:columns -->',
			issue: 'core/columns\'s "verticalAlignment" is of type string, so WordPress ignores null.',
			losses: [],
		},
	] )(
		'reports an attribute of the wrong type, and $name',
		async ( { markup, issue, losses } ) => {
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.results[ 0 ].issues ).toContain( issue );
			expect( report.proposedFix?.losses ).toEqual( losses );
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
		},
		60_000
	);

	it( 'reports HTML outside any block', async () => {
		const report = await validateBlocks(
			`<section class="hero"><h1>Hi</h1></section>\n${ paragraph( '{}', '<p>Ok</p>' ) }`,
			siteUrl!
		);
		expect( report.results ).toContainEqual(
			expect.objectContaining( { blockName: 'core/freeform', isValid: false } )
		);
		expect( report.validBlocks ).toBe( 1 );
	}, 60_000 );

	it( 'reads entities as the text they show', async () => {
		const report = await validateBlocks(
			group( '{}', paragraph( '{}', '<p>A &mdash; B&nbsp;C</p>' ) ),
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [] );
	}, 60_000 );

	it.each( [
		{
			name: 'its classes',
			written:
				'<!-- wp:image -->\n<figure class="wp-block-image"><img class="photo" src="https://example.com/a.png" alt=""/></figure>\n<!-- /wp:image -->',
			blockName: 'core/image',
			lost: 'drop the classes photo',
		},
		{
			name: 'its styles',
			written: paragraph( '{}', '<p style="position:sticky;top:0">Eyebrow</p>' ),
			blockName: 'core/paragraph',
			lost: 'drop the styles position:sticky; top:0px',
		},
		{
			name: 'its text',
			written: paragraph( '{}', '<div>Lost words</div>' ),
			blockName: 'core/paragraph',
			lost: 'change the text',
		},
	] )(
		'names the block whose fix would lose $name, keeps it as written and saves the fix for the rest',
		async ( { written, blockName, lost } ) => {
			const markup = group(
				'{}',
				`${ paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ) }\n${ written }`
			);
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( [ { place: '/0/1', blockName, lost } ] );
			expect( report.proposedFix?.fixedContent ).toContain( 'has-text-align-center' );
			expect( report.proposedFix?.fixedContent ).toContain(
				`-->\n${ written.split( '\n' )[ 1 ] }\n<!--`
			);
		},
		60_000
	);
} );

describe.runIf( siteUrl )( 'storing palette colors as presets (live)', () => {
	afterAll( cleanupValidatorPages );
	const palette: Array< [ string, string ] > = [
		[ 'base', '#FFFFFF' ],
		[ 'accent-3', '#503AA8' ],
	];

	it( 'stores each color a palette color has as that preset, as the editor does', async () => {
		const markup = group(
			'{"style":{"color":{"background":"#503aa8","text":"#FFFFFF"},"elements":{"link":{"color":{"text":"#FFFFFF"}}}},"layout":{"type":"constrained"}}',
			'<div class="wp-block-group has-text-color has-background has-link-color" style="color:#FFFFFF;background-color:#503aa8">' +
				paragraph(
					'{"style":{"color":{"background":"#123456"}}}',
					'<p class="has-background" style="background-color:#123456">Custom stays</p>'
				) +
				'</div>'
		);
		const result = await storePaletteColors( markup, siteUrl!, palette );

		expect( result.colors ).toEqual( [
			{ color: '#503aa8', slug: 'accent-3' },
			{ color: '#FFFFFF', slug: 'base' },
			{ color: '#FFFFFF', slug: 'base' },
		] );
		expect( result.content ).toContain(
			'<!-- wp:group {"style":{"elements":{"link":{"color":{"text":"var:preset|color|base"}}}},"backgroundColor":"accent-3","textColor":"base","layout":{"type":"constrained"}} -->'
		);
		expect( result.content ).toContain( 'has-base-color has-accent-3-background-color' );
		expect( result.content ).toContain( 'background-color:#123456' );
		expect( ( await validateBlocks( result.content, siteUrl! ) ).invalidBlocks ).toBe( 0 );
	} );

	it( 'leaves no empty style behind', async () => {
		const markup = paragraph(
			'{"style":{"color":{"text":"#503AA8"}}}',
			'<p class="has-text-color" style="color:#503AA8">Hi</p>'
		);
		expect( ( await storePaletteColors( markup, siteUrl!, palette ) ).content ).toBe(
			paragraph( '{"textColor":"accent-3"}', '<p class="has-accent-3-color has-text-color">Hi</p>' )
		);
	} );

	it( 'returns content without palette values as written', async () => {
		const markup = paragraph(
			'{"textColor":"base"}',
			'<p class="has-base-color has-text-color">Hi</p>'
		);
		expect( await storePaletteColors( markup, siteUrl!, palette ) ).toEqual( {
			content: markup,
			colors: [],
		} );
	} );

	const hello = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';
	it.each( [
		{
			name: 'comments between blocks',
			markup: `<!-- ===== HERO ===== -->\n${ hello }\n\n<!-- one --><!-- two -->\n${ hello }`,
			expected: { content: `${ hello }\n\n${ hello }`, comments: 2 },
		},
		{
			name: 'a comment inside a block',
			markup: paragraph( '', '<p>Hello<!-- note --></p>' ),
			expected: { content: paragraph( '', '<p>Hello<!-- note --></p>' ), comments: 0 },
		},
		{
			name: 'a comment beside HTML outside any block',
			markup: `<!-- note --><div>Hi</div>\n${ hello }`,
			expected: { content: `<!-- note --><div>Hi</div>\n${ hello }`, comments: 0 },
		},
		{
			name: 'a paragraph holding only a comment',
			markup: '<!-- wp:paragraph -->\n<p><!-- note --></p>\n<!-- /wp:paragraph -->',
			expected: {
				content: '<!-- wp:paragraph -->\n<p><!-- note --></p>\n<!-- /wp:paragraph -->',
				comments: 0,
			},
		},
		{
			name: 'a line break outside any block, beside a comment',
			markup: `<br>\n${ hello }\n<!-- note -->\n${ hello }`,
			// The editor's parse wraps the line break in a paragraph (autop).
			expected: { content: `<p></p>\n\n${ hello }\n\n${ hello }`, comments: 1 },
		},
		{
			name: 'no comments',
			markup: hello,
			expected: { content: hello, comments: 0 },
		},
	] )( 'drops what renders nothing between blocks: $name', async ( { markup, expected } ) => {
		expect( await dropCommentsBetweenBlocks( markup, siteUrl! ) ).toEqual( expected );
	} );

	it( 'keeps a comment between blocks from becoming a Classic block when colors are stored', async () => {
		const markup = `<!-- ===== HERO ===== -->\n${ paragraph(
			'{"style":{"color":{"background":"#503AA8"}}}',
			'<p class="has-background" style="background-color:#503AA8">Hello</p>'
		) }`;
		const stored = async ( content: string ) =>
			( await storePaletteColors( content, siteUrl!, palette ) ).content;
		expect( ( await validateBlocks( await stored( markup ), siteUrl! ) ).results ).toEqual(
			expect.arrayContaining( [ expect.objectContaining( { blockName: 'core/freeform' } ) ] )
		);
		const dropped = ( await dropCommentsBetweenBlocks( markup, siteUrl! ) ).content;
		expect( ( await validateBlocks( await stored( dropped ), siteUrl! ) ).invalidBlocks ).toBe( 0 );
	} );

	const nav = ( links: string ) => `<!-- wp:navigation -->\n${ links }\n<!-- /wp:navigation -->`;
	const postLink =
		'<!-- wp:navigation-link {"label":"About","type":"page","id":2,"kind":"post-type","metadata":{"bindings":{"url":{"source":"core/post-data","args":{"field":"link"}}}}} /-->';

	it.each( [
		{
			name: 'a page named by id with no url',
			markup: nav( '<!-- wp:navigation-link {"label":"About","type":"page","id":2} /-->' ),
			bound: [ 'About' ],
			has: postLink,
		},
		{
			name: 'a category named by id, in a submenu',
			markup: nav(
				'<!-- wp:navigation-submenu {"label":"More","type":"page","id":2,"kind":"post-type"} -->\n<!-- wp:navigation-link {"label":"News","type":"category","id":1} /-->\n<!-- /wp:navigation-submenu -->'
			),
			bound: [ 'News', 'More' ],
			has: '{"label":"News","type":"category","id":1,"kind":"taxonomy","metadata":{"bindings":{"url":{"source":"core/term-data","args":{"field":"link"}}}}}',
		},
		{
			name: 'a link with a url',
			markup: nav(
				'<!-- wp:navigation-link {"label":"About","type":"page","id":2,"url":"/about/"} /-->'
			),
			bound: [],
		},
		{
			name: 'a link already bound',
			markup: nav( postLink ),
			bound: [],
		},
		{
			name: 'a custom link',
			markup: nav( '<!-- wp:navigation-link {"label":"Shop","kind":"custom","id":7} /-->' ),
			bound: [],
		},
	] )( 'binds a navigation link to what it names: $name', async ( { markup, bound, has } ) => {
		const result = await bindNavigationLinks( markup, siteUrl! );
		expect( result.links ).toEqual( bound );
		if ( has ) {
			expect( result.content ).toContain( has );
		} else {
			expect( result.content ).toBe( markup );
		}
	} );

	// The site's editor tab, as the validator loaded it.
	const editorTab = async () =>
		( await getSharedBrowser() )
			.contexts()
			.flatMap( ( context ) => context.pages() )
			.find(
				( page ) =>
					page.url().startsWith( siteUrl! ) &&
					page.url().includes( 'post-new.php' ) &&
					! page.isClosed()
			)!;

	it( 'gives what the editor inserts for blocks whose default variation brings inner blocks', async () => {
		await insertedTemplates( [ 'core/paragraph' ], siteUrl! );
		// As a plugin registers them: each inserts the next, and the last a paragraph.
		await (
			await editorTab()
		).evaluate( () => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const { blocks, blockEditor, element } = ( window as any ).wp;
			for ( const [ name, inner ] of [
				[ 'studio-test/form', 'studio-test/field' ],
				[ 'studio-test/field', 'core/paragraph' ],
				[ 'studio-test/a', 'core/paragraph' ],
				[ 'studio-test/b', 'core/paragraph' ],
				[ 'studio-test/c', 'core/paragraph' ],
			] ) {
				blocks.registerBlockType( name, {
					apiVersion: 3,
					title: name,
					category: 'widgets',
					attributes: { kind: { type: 'string' } },
					edit: () => null,
					save: () => element.createElement( blockEditor.InnerBlocks.Content ),
					variations: [
						{
							name: 'default',
							title: name,
							isDefault: true,
							scope: [ 'inserter' ],
							attributes: { kind: 'default' },
							innerBlocks: [ [ inner, inner === 'core/paragraph' ? { content: 'Hi' } : {} ] ],
						},
					],
				} );
			}
			/* eslint-enable @typescript-eslint/no-explicit-any */
		} );

		expect( await insertedTemplates( [ 'studio-test/field' ], siteUrl! ) ).toEqual( [
			{
				name: 'studio-test/field',
				markup:
					'<!-- wp:studio-test/field {"kind":"default"} -->\n<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->\n<!-- /wp:studio-test/field -->',
			},
		] );
		// A block another insert holds, and blocks that insert no inner blocks, are left out.
		expect(
			(
				await insertedTemplates(
					[ 'studio-test/field', 'core/paragraph', 'studio-test/form', 'core/group' ],
					siteUrl!
				)
			).map( ( template ) => template.name )
		).toEqual( [ 'studio-test/form' ] );
		expect(
			(
				await insertedTemplates(
					[ 'studio-test/a', 'studio-test/b', 'studio-test/c', 'studio-test/field' ],
					siteUrl!
				)
			).map( ( template ) => template.name )
		).toEqual( [ 'studio-test/a', 'studio-test/b', 'studio-test/c' ] );
	} );

	it( 'reports a block that is not registered, with the blocks its namespace registers', async () => {
		const report = await validateBlocks(
			'<!-- wp:core/paragraphs -->\n<p>A</p>\n<!-- /wp:core/paragraphs -->\n\n<!-- wp:nope/form /-->',
			siteUrl!
		);
		expect( report.invalidBlocks ).toBe( 2 );
		expect( report.results[ 0 ] ).toMatchObject( {
			blockName: 'core/paragraphs',
			isValid: false,
			originalContent: expect.stringContaining( '<p>A</p>' ),
		} );
		expect( report.results[ 0 ].issues[ 0 ] ).toMatch(
			/^core\/paragraphs is not registered on the site, so the editor shows it as an unsupported block\. The registered core\/ blocks are .*core\/paragraph,/
		);
		expect( report.results[ 1 ].issues[ 0 ] ).toBe(
			"nope/form is not registered on the site, so the editor shows it as an unsupported block. No nope/ blocks are registered in the site's block editor."
		);
	} );

	it( 'loads the editor again for a block registered since it loaded', async () => {
		// As a block of a plugin activated after the editor loaded.
		const forget = async ( name: string ) =>
			( await editorTab() ).evaluate(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				( block ) => ( window as any ).wp.blocks.unregisterBlockType( block ),
				name
			);
		await insertedTemplates( [ 'core/paragraph' ], siteUrl! );
		const loaded = await editorTab();
		// A block the editor knows, without a namespace as core's are written, keeps it.
		await validateBlocks( '<!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph -->', siteUrl! );
		expect( loaded.isClosed() ).toBe( false );

		await forget( 'core/verse' );
		await insertedTemplates( [ 'core/verse' ], siteUrl! );
		expect( loaded.isClosed() ).toBe( true );

		await forget( 'core/verse' );
		const report = await validateBlocks(
			'<!-- wp:verse -->\n<pre class="wp-block-verse">A</pre>\n<!-- /wp:verse -->',
			siteUrl!
		);
		expect( report.invalidBlocks ).toBe( 0 );
	}, 60_000 );
} );

describe.runIf( siteUrl && sitePath )( 'a block whose editor script throws (live)', () => {
	afterAll( cleanupValidatorPages );

	it( 'reports what the editor threw beside the block it did not register', async () => {
		// As a plugin writes a block.json editorScript that reads wp, with no
		// index.asset.php naming the scripts it depends on.
		const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower' );
		mkdirSync( plugin, { recursive: true } );
		writeFileSync(
			path.join( plugin, 'block.json' ),
			JSON.stringify( {
				apiVersion: 3,
				name: 'studio-test/thrower',
				title: 'Thrower',
				editorScript: 'file:./index.js',
			} )
		);
		writeFileSync(
			path.join( plugin, 'index.js' ),
			"wp.blocks.registerBlockType( 'studio-test/thrower', { edit: () => null, save: () => null } );\n"
		);
		writeFileSync(
			path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower.php' ),
			"<?php\nadd_action( 'init', fn() => register_block_type( __DIR__ . '/studio-test-thrower/block.json' ) );\n"
		);
		try {
			const report = await validateBlocks( '<!-- wp:studio-test/thrower /-->', siteUrl! );
			expect( report.results[ 0 ].issues[ 0 ] ).toMatch(
				/^studio-test\/thrower is not registered on the site, so the editor shows it as an unsupported block\. No studio-test\/ blocks are registered in the site's block editor\. The site's block editor threw: wp is not defined \(http:\/\/\S+\/wp-content\/mu-plugins\/studio-test-thrower\/index\.js line 1\)\.$/
			);
		} finally {
			rmSync( plugin, { recursive: true, force: true } );
			rmSync( path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower.php' ), {
				force: true,
			} );
		}
	}, 60_000 );
} );
