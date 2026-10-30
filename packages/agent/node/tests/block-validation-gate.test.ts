import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BlockValidationGate,
	isBlockMarkupFile,
	validateBlockMarkupFile,
} from '@studio/agent/node/block-validation-gate';
import {
	bindNavigationLinks,
	dropCommentsBetweenBlocks,
	insertedTemplates,
	storePresetValues,
	validateBlocks,
	type BlockLoss,
	type ValidationReport,
} from '@studio/agent/node/block-validator';
import { OpenProblems } from '@studio/agent/node/open-problems';

vi.mock( '@studio/agent/node/block-validator', async () => ( {
	validateBlocks: vi.fn(),
	storePresetValues: vi.fn( async ( content: string ) => ( {
		content,
		colors: [],
		fontSizes: [],
		spacingSizes: [],
	} ) ),
	bindNavigationLinks: vi.fn( async ( content: string ) => ( { content, links: [] } ) ),
	dropCommentsBetweenBlocks: vi.fn( async ( content: string ) => ( { content, comments: 0 } ) ),
	insertedTemplates: vi.fn( async () => [] ),
	blocksSavingElements: vi.fn( async () => [
		{ element: 'div', blocks: Array.from( { length: 14 }, ( _, i ) => `core/b${ i + 10 }` ) },
		{ element: 'details', blocks: [ 'core/details' ] },
		{ element: 'summary', blocks: [] },
	] ),
	blockNames: (
		await vi.importActual< typeof import('@studio/agent/node/block-validator') >(
			'@studio/agent/node/block-validator'
		)
	).blockNames,
} ) );

let site: string;

function write( relativePath: string, content: string ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	return file;
}

function invalidWithFix( fixedContent: string, losses: BlockLoss[] = [] ): ValidationReport {
	return {
		totalBlocks: 1,
		validBlocks: 0,
		invalidBlocks: 1,
		results: [
			{
				blockName: 'core/paragraph',
				place: '/0',
				isValid: false,
				issues: [ 'mismatch' ],
				originalContent: '',
			},
		],
		proposedFix: {
			fixedContent,
			losses,
			report: { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] },
		},
	};
}

beforeEach( () => {
	site = mkdtempSync( path.join( os.tmpdir(), 'studio-gate-' ) );
	vi.mocked( validateBlocks ).mockReset();
} );

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

describe( 'block markup files', () => {
	it( 'covers theme templates and parts, and any file that opens with a block', () => {
		expect( isBlockMarkupFile( '/s/wp-content/themes/t/parts/header.html' ) ).toBe( true );
		expect( isBlockMarkupFile( '/s/wp-content/themes/t/templates/index.html' ) ).toBe( true );
		const draft = write( 'wp-content/uploads/home.tmp.html', '\n<!-- wp:paragraph -->' );
		expect( isBlockMarkupFile( draft ) ).toBe( true );
		// Code that mentions a delimiter, as a block's built script does.
		const script = write( 'build/index.js', 'save: () => "<!-- wp:paragraph -->"' );
		expect( isBlockMarkupFile( script ) ).toBe( false );
		expect( isBlockMarkupFile( write( 'tmp/page-home.html', '<p>Hi</p>' ) ) ).toBe( false );
		expect( isBlockMarkupFile( '/s/missing.html' ) ).toBe( false );
	} );

	const HEADER = '<?php\n/**\n * Title: Cards\n */\n?>\n';
	it.each( [
		{ name: 'whose only PHP is its header', content: `${ HEADER }<!-- wp:paragraph -->`, is: true },
		{
			name: 'that holds PHP after its header',
			content: `${ HEADER }<p><?php echo 1; ?></p>`,
			is: false,
		},
		{ name: 'with no header', content: '<?php echo "<p>Hi</p>";', is: false },
	] )( 'covers a theme pattern $name: $is', ( { content, is } ) => {
		const pattern = write( 'wp-content/themes/t/patterns/cards.php', content );
		expect( isBlockMarkupFile( pattern ) ).toBe( is );
	} );
} );

describe( 'validating a file', () => {
	const original = '<!-- wp:paragraph {"align":"center"} --><p>Hello</p><!-- /wp:paragraph -->';
	const fixed =
		'<!-- wp:paragraph {"align":"center"} -->\n<p class="has-text-align-center">Hello</p>\n<!-- /wp:paragraph -->';

	it( 'returns a lossless editor fix without writing it', async () => {
		const file = write( 'tmp/home.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toBeUndefined();
		expect( result.summary ).toContain(
			'1/1 blocks valid; saved through the block editor, which fixes 1 block(s)'
		);
		expect( result.fixedContent ).toBe( fixed );
		expect( readFileSync( file, 'utf8' ) ).toBe( original );
	} );

	it.each( [
		[ 'wp-content/themes/t/templates/archive.html', 'site' ],
		[ 'wp-content/themes/t/parts/header.html', 'site' ],
		[ 'tmp/home.html', 'post' ],
	] )( 'validates %s in the editor that edits it, the %s editor', async ( file, editor ) => {
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		await validateBlockMarkupFile( write( file, original ), 'http://localhost:8881' );
		expect( vi.mocked( validateBlocks ).mock.calls[ 0 ][ 2 ] ).toBe( editor );
	} );

	const GROUP = '<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">';
	it.each< { name: string; content: string; problems: string[] } >( [
		{
			name: 'a block another closer closes',
			content: `${ GROUP }<!-- wp:paragraph -->\n<p>One</p>\n<!-- wp:heading -->\n<h2 class="wp-block-heading">Two</h2>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->`,
			problems: [
				'line 2: core/paragraph has no closer of its own, so the parser closes it at the core/group closer on line 7',
			],
		},
		{
			name: 'a block inside groups in a group',
			content: `${ GROUP }${ GROUP }<!-- wp:paragraph -->\n<p>a</p></div>\n<!-- /wp:group --></div>\n<!-- /wp:group -->`,
			problems: [
				'line 3: core/paragraph has no closer of its own, so the parser closes it at the core/group closer on line 5',
			],
		},
		{
			name: 'a closer that names no open block',
			content: `${ GROUP }<!-- wp:paragraph -->\n<p>a</p>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->`,
			problems: [
				'line 2: core/paragraph has no closer of its own, so the parser closes it at the core/heading closer on line 4',
			],
		},
		{
			name: 'a block never closed',
			content: '<!-- wp:paragraph -->\n<p>One</p>\n\n<!-- wp:my-plugin/card /-->',
			problems: [
				'line 1: core/paragraph is never closed, so the parser gives it the rest of the content',
			],
		},
		{
			name: 'a namespaced block another closer closes',
			content:
				'<!-- wp:columns -->\n<!-- wp:my-plugin/card {"a":"}"} -->\n<p>x</p>\n<!-- /wp:columns -->',
			problems: [
				'line 2: my-plugin/card has no closer of its own, so the parser closes it at the core/columns closer on line 4',
			],
		},
	] )(
		'saves nothing for $name, and names where each block is closed',
		async ( { content, problems } ) => {
			const file = write( 'tmp/home.html', content );
			const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
			expect( result.fixedContent ).toBeUndefined();
			expect( result.summary ).toBe( `tmp/home.html: ${ problems.length } block(s) not closed` );
			expect( result.problem?.split( '\n' ).slice( 1 ) ).toEqual(
				problems.map( ( problem ) => `  - ${ problem }` )
			);
			expect( result.problem ).toContain( 'WP_Block_Parser::add_block_from_stack()' );
			expect( validateBlocks ).not.toHaveBeenCalled();
		}
	);

	it( 'validates blocks each closed by its own closer, void blocks and all', async () => {
		const file = write(
			'tmp/home.html',
			`${ GROUP }<!-- wp:spacer {"height":"1px"} /-->\n<!-- wp:paragraph -->\n<p>a</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->`
		);
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.fixedContent ).toBe( fixed );
		expect( validateBlocks ).toHaveBeenCalled();
	} );

	it( 'validates and fixes the blocks beside a core/html block the policy fails', async () => {
		const html =
			'<!-- wp:html -->\n<div class="faq"><details><summary>Hours?</summary><p>9 to 5.</p></details></div>\n<!-- /wp:html -->';
		const file = write( 'tmp/home.html', `${ original }\n\n${ html }` );
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( `${ fixed }\n\n${ html }` ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.fixedContent ).toBe( `${ fixed }\n\n${ html }` );
		expect( result.summary ).toMatch(
			/1\/1 blocks valid; core\/html policy failed; saved through the block editor, which fixes 1 block\(s\)$/
		);
		expect( result.problem ).toBe(
			[
				`tmp/home.html: 1 core/html block(s) hold markup the editor shows as raw HTML, which convert_to_blocks saves as editable blocks:`,
				'  - line 3: core/html contains markup that should use editable blocks. Keep core/html only for inline SVG, interaction markup with no block equivalent (marquee, cursor), or a single script block.',
				"The site's blocks whose save makes its elements, created with their defaults (createBlock() and getSaveContent() in @wordpress/blocks): <div> core/b10, core/b11, core/b12, core/b13, core/b14, core/b15, core/b16, core/b17, core/b18, core/b19, core/b20, core/b21 and 2 more; <details> core/details.",
			].join( '\n' )
		);
	} );

	it( 'states both a core/html block the policy fails and a block the editor cannot fix', async () => {
		const file = write(
			'tmp/home.html',
			`${ original }\n\n<!-- wp:html --><div><p>Hi</p></div><!-- /wp:html -->`
		);
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 2,
			validBlocks: 1,
			invalidBlocks: 1,
			results: [
				{
					blockName: 'core/paragraph',
					isValid: false,
					issues: [ 'Expected token' ],
					originalContent: original,
				},
			],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.summary ).toBe( 'tmp/home.html: 1 invalid block(s); core/html policy failed' );
		expect( result.problem ).toMatch(
			/^tmp\/home\.html: 1 core\/html block\(s\) hold markup the editor shows as raw HTML, which convert_to_blocks saves as editable blocks:\n[\s\S]*\ntmp\/home\.html: 1 invalid block\(s\), which the block editor cannot fix:/
		);
	} );

	it( "validates a pattern's markup and keeps its header in the fix", async () => {
		const header = '<?php\n/**\n * Title: Hello\n */\n?>\n';
		const file = write( 'wp-content/themes/t/patterns/hello.php', header + original );
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( validateBlocks ).toHaveBeenCalledWith( original, 'http://localhost:8881', 'post' );
		expect( result.fixedContent ).toBe( header + fixed );
	} );

	it.each( [
		{
			name: 'PHP beyond its header',
			content: '<?php\n/**\n * Title: Hello\n */\n?>\n<p><?php echo 1; ?></p>',
		},
		{ name: 'no header', content: '<?php echo "<p>Hi</p>";' },
	] )( 'does not validate a pattern with $name', async ( { content } ) => {
		const file = write( 'wp-content/themes/t/patterns/hello.php', content );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( validateBlocks ).not.toHaveBeenCalled();
		expect( result ).toEqual( {
			contentHash: expect.any( String ),
			summary: 'patterns/hello.php: not validated, as it holds PHP',
		} );
	} );

	it( "returns the content with the palette's colors stored as presets", async () => {
		const file = write( 'parts/hero.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
		} );
		vi.mocked( storePresetValues ).mockResolvedValueOnce( {
			content: fixed,
			colors: [ { color: '#503AA8', slug: 'accent-3' } ],
			fontSizes: [],
			spacingSizes: [],
		} );
		const palette = {
			colors: [ [ 'accent-3', '#503AA8' ] ] as Array< [ string, string ] >,
			fontSizes: [],
			spacingSizes: [],
		};
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881', palette );
		expect( storePresetValues ).toHaveBeenLastCalledWith(
			original,
			'http://localhost:8881',
			palette,
			'post'
		);
		expect( result.summary ).toBe(
			"parts/hero.html: 1/1 blocks valid; saved through the block editor, which stores #503AA8 as the palette's accent-3, as the editor stores a palette color (encodeColorValueWithPalette in @wordpress/block-editor), so it follows the palette"
		);
		expect( result.fixedContent ).toBe( fixed );
	} );

	it( 'returns the content with its entity links bound, as the link picker binds them', async () => {
		const file = write( 'parts/header.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
		} );
		vi.mocked( bindNavigationLinks ).mockResolvedValueOnce( {
			content: fixed,
			links: [ 'About' ],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( bindNavigationLinks ).toHaveBeenLastCalledWith(
			original,
			'http://localhost:8881',
			'post'
		);
		expect( result.summary ).toContain( 'binds the url of the navigation link(s) "About"' );
		expect( result.fixedContent ).toBe( fixed );
	} );

	it( 'returns the content with the comments between its blocks dropped', async () => {
		const file = write( 'templates/page.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
		} );
		vi.mocked( dropCommentsBetweenBlocks ).mockResolvedValueOnce( { content: fixed, comments: 2 } );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881', {
			colors: [ [ 'accent-3', '#503AA8' ] ],
			fontSizes: [],
			spacingSizes: [],
		} );
		expect( dropCommentsBetweenBlocks ).toHaveBeenLastCalledWith(
			original,
			'http://localhost:8881',
			'post'
		);
		expect( storePresetValues ).toHaveBeenLastCalledWith(
			fixed,
			'http://localhost:8881',
			{
				colors: [ [ 'accent-3', '#503AA8' ] ],
				fontSizes: [],
				spacingSizes: [],
			},
			'post'
		);
		expect( result.summary ).toContain(
			'drops 2 HTML comment(s) between blocks, which the editor would turn into Classic blocks'
		);
		expect( result.fixedContent ).toBe( fixed );
	} );

	it( 'keeps the content as written when what the editor would store has more problems', async () => {
		const file = write( 'templates/page.html', original );
		const valid = { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] };
		vi.mocked( validateBlocks )
			.mockResolvedValueOnce( valid )
			.mockResolvedValueOnce( { ...valid, validBlocks: 0, invalidBlocks: 1 } );
		vi.mocked( storePresetValues ).mockResolvedValueOnce( {
			content: fixed,
			colors: [ { color: '#503AA8', slug: 'accent-3' } ],
			fontSizes: [],
			spacingSizes: [],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( validateBlocks ).toHaveBeenLastCalledWith( fixed, 'http://localhost:8881', 'post' );
		expect( result ).toEqual( {
			contentHash: expect.any( String ),
			summary: 'templates/page.html: 1/1 blocks valid',
		} );
	} );

	it( 'saves the fix for the blocks that lose nothing, and names the blocks that would', async () => {
		const file = write( 'tmp/home.html', `${ original }\n${ original }` );
		const report = invalidWithFix( `${ fixed }\n${ original }`, [
			{ place: '/1', blockName: 'core/paragraph', lost: 'drop the classes eyebrow' },
		] );
		report.invalidBlocks = 2;
		report.results.push( { ...report.results[ 0 ], place: '/1', issues: [ 'second' ] } );
		vi.mocked( validateBlocks ).mockResolvedValue( report );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.fixedContent ).toBe( `${ fixed }\n${ original }` );
		expect( result.summary ).toBe(
			'tmp/home.html: 1 invalid block(s); saved through the block editor, which fixes 1 block(s)'
		);
		expect( result.problem ).toContain(
			"core/paragraph: the editor's fix would drop the classes eyebrow; second"
		);
		expect( result.problem ).not.toContain( 'mismatch' );
	} );

	it( 'saves nothing when the fix itself does not validate', async () => {
		const file = write( 'tmp/home.html', original );
		const report = invalidWithFix( fixed );
		report.proposedFix!.report.invalidBlocks = 1;
		vi.mocked( validateBlocks ).mockResolvedValue( report );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.fixedContent ).toBeUndefined();
		expect( result.problem ).toContain( 'which the block editor cannot fix' );
	} );

	it( 'shows each mismatch and the HTML the block saves', async () => {
		const file = write(
			'tmp/home.html',
			'<!-- wp:cover {"dimRatio":45} --><div class="wp-block-cover">x</div><!-- /wp:cover -->'
		);
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 0,
			invalidBlocks: 1,
			results: [
				{
					blockName: 'core/cover',
					isValid: false,
					issues: [ 'Expected attribute `class` of value `a`, saw `b`.' ],
					originalContent: '<div class="wp-block-cover">x</div>',
					expectedContent: '<div class="wp-block-cover has-background-dim-50">x</div>',
				},
			],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain(
			'core/cover: Expected attribute `class` of value `a`, saw `b`.'
		);
		expect( result.problem ).toContain(
			'the block saves: <div class="wp-block-cover has-background-dim-50">x</div>'
		);
	} );

	const form = {
		name: 'jetpack/contact-form',
		markup:
			'<!-- wp:jetpack/contact-form -->\n<div class="wp-block-jetpack-contact-form"></div>\n<!-- /wp:jetpack/contact-form -->',
	};
	const insertsForm = `What the site's block editor inserts for jetpack/contact-form, from its default inserter variation (createBlock in @wordpress/blocks), to write it from:\n${ form.markup }`;

	it( 'validates in the editor beside a core/html block the policy fails, with what the editor inserts for the block it names', async () => {
		const file = write(
			'tmp/home.html',
			'<!-- wp:html --><form><input /></form><!-- /wp:html -->'
		);
		vi.mocked( insertedTemplates ).mockResolvedValueOnce( [ form ] );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.summary ).toBe( 'tmp/home.html: 1/1 blocks valid; core/html policy failed' );
		expect( result.problem ).toContain( 'core/html contains form markup' );
		expect( result.problem!.endsWith( insertsForm ) ).toBe( true );
		expect( insertedTemplates ).toHaveBeenLastCalledWith(
			[ 'jetpack/contact-form' ],
			'http://localhost:8881'
		);
		expect( validateBlocks ).toHaveBeenCalled();
	} );

	it( 'shows what the editor inserts for the blocks an unfixable block holds', async () => {
		const written =
			'<div class="wp-block-group"><!-- wp:jetpack/contact-form --><!-- wp:jetpack/field-name /--><!-- /wp:jetpack/contact-form --></div>';
		const file = write( 'tmp/home.html', `<!-- wp:group -->${ written }<!-- /wp:group -->` );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 2,
			validBlocks: 1,
			invalidBlocks: 1,
			results: [
				{
					blockName: 'core/paragraph',
					isValid: true,
					issues: [],
					originalContent: '<!-- wp:paragraph -->',
				},
				{
					blockName: 'core/group',
					isValid: false,
					issues: [ 'Expected token' ],
					originalContent: written,
				},
			],
		} );
		vi.mocked( insertedTemplates ).mockResolvedValueOnce( [ form ] );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( insertedTemplates ).toHaveBeenLastCalledWith(
			[ 'jetpack/contact-form', 'jetpack/field-name' ],
			'http://localhost:8881'
		);
		expect( result.problem ).toContain( 'which the block editor cannot fix' );
		expect( result.problem!.endsWith( insertsForm ) ).toBe( true );
	} );

	it( 'reports an unfixable block when the editor cannot say what it inserts', async () => {
		const file = write( 'tmp/home.html', original );
		const report = invalidWithFix( fixed );
		report.proposedFix!.report.invalidBlocks = 1;
		vi.mocked( validateBlocks ).mockResolvedValue( report );
		vi.mocked( insertedTemplates ).mockRejectedValueOnce( new Error( 'editor closed' ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain( 'which the block editor cannot fix' );
		expect( result.problem ).not.toContain( 'inserts' );
	} );
} );

describe( 'the gate', () => {
	const ok = ( summary: string, content: string ) => ( {
		contentHash: createHash( 'sha1' ).update( content ).digest( 'hex' ),
		summary,
	} );

	it( 'reports each validated file once, and revalidates a file that changed', async () => {
		const file = write( 'wp-content/themes/t/templates/home.html', 'v1' );
		const validateFile = vi.fn( async ( filePath: string ) =>
			ok( `validated ${ readFileSync( filePath, 'utf8' ) }`, readFileSync( filePath, 'utf8' ) )
		);
		const gate = new BlockValidationGate( validateFile );
		gate.track( file, site );
		writeFileSync( file, 'v2' );
		expect( ( await gate.settle() ).summaries ).toEqual( [ 'validated v2' ] );
		expect( ( await gate.settle() ).summaries ).toEqual( [] );
	} );

	it( "leaves another agent's files for that agent's settle", async () => {
		const mine = write( 'wp-content/themes/t/templates/home.html', 'home' );
		const theirs = write( 'wp-content/themes/t/templates/page.html', 'page' );
		const gate = new BlockValidationGate( async ( filePath ) =>
			ok( `validated ${ readFileSync( filePath, 'utf8' ) }`, readFileSync( filePath, 'utf8' ) )
		);
		gate.track( mine, site );
		gate.track( theirs, site );
		expect( ( await gate.settle( { mine: ( file ) => file === mine } ) ).summaries ).toEqual( [
			'validated home',
		] );
		expect( ( await gate.settle() ).summaries ).toEqual( [ 'validated page' ] );
	} );

	it( 'reports, without waiting, only the validations of current content that have come', async () => {
		const done = write( 'wp-content/themes/t/templates/home.html', 'home' );
		const writing = write( 'wp-content/themes/t/parts/header.html', 'header' );
		const changed = write( 'wp-content/themes/t/parts/footer.html', 'footer' );
		const slow = write( 'wp-content/themes/t/templates/page.html', 'page' );
		let finish: () => void = () => {};
		const gate = new BlockValidationGate( async ( filePath ) => {
			const content = readFileSync( filePath, 'utf8' );
			if ( content === 'page' ) {
				await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			}
			return ok( `validated ${ content }`, content );
		} );
		for ( const file of [ done, writing, changed, slow ] ) {
			gate.track( file, site );
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
		writeFileSync( changed, 'footer v2' );
		expect( ( await gate.settle( { ready: true, except: writing } ) ).summaries ).toEqual( [
			'validated home',
		] );
		finish();
		expect( ( await gate.settle() ).summaries ).toEqual( [
			'validated header',
			'validated footer v2',
			'validated page',
		] );
	} );

	it( 'saves a lossless fix once settled, never over a write made while it validated', async () => {
		const file = write( 'wp-content/themes/t/templates/home.html', 'v1' );
		let finish: () => void = () => {};
		const validateFile = vi.fn( async ( filePath: string ) => {
			const content = readFileSync( filePath, 'utf8' );
			if ( content === 'v1' ) {
				await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			}
			return { ...ok( `validated ${ content }`, content ), fixedContent: `${ content } fixed` };
		} );
		const gate = new BlockValidationGate( validateFile );
		gate.track( file, site );
		writeFileSync( file, 'v2' );
		finish();
		expect( ( await gate.settle() ).summaries ).toEqual( [
			`validated v2\nStudio changed ${ file } after the write; lines 1-1 now read:\n~~~\nv2 fixed\n~~~`,
		] );
		expect( readFileSync( file, 'utf8' ) ).toBe( 'v2 fixed' );
		expect( ( await gate.settle() ).summaries ).toEqual( [] );
	} );

	it( 'keeps a file open while its latest validation has a problem', async () => {
		const file = write( 'wp-content/themes/t/templates/home.html', 'bad' );
		const open = new OpenProblems( [] );
		const gate = new BlockValidationGate( async ( filePath ) => {
			const content = readFileSync( filePath, 'utf8' );
			return {
				...ok( content, content ),
				problem: content === 'bad' ? 'home.html is invalid' : undefined,
			};
		}, open );
		gate.track( file, site );
		await gate.settle();
		writeFileSync( file, 'good' );
		gate.track( file, site );
		await gate.settle();
		expect( await open.raise() ).toEqual( [] );
		writeFileSync( file, 'bad' );
		gate.track( file, site );
		await gate.settle();
		expect( await open.raise() ).toEqual( [ 'home.html is invalid' ] );
	} );

	it( 'reports a file it could not validate', async () => {
		const gate = new BlockValidationGate( async () => {
			throw new Error( 'the site is not running' );
		} );
		gate.track( write( 'wp-content/themes/t/parts/header.html', 'x' ), site );
		expect( ( await gate.settle() ).summaries ).toEqual( [
			'parts/header.html: not validated (the site is not running)',
		] );
		expect( ( await gate.settle() ).summaries ).toEqual( [] );
	} );

	it( 'ignores files that are not block markup', async () => {
		const validateFile = vi.fn();
		const gate = new BlockValidationGate( validateFile );
		gate.track( write( 'wp-content/themes/t/style.css', '' ), site );
		expect( validateFile ).not.toHaveBeenCalled();
	} );
} );
