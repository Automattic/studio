import { createHash } from 'crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	BlockValidationGate,
	isBlockMarkupFile,
	validateBlockMarkupFile,
} from 'cli/ai/block-validation-gate';
import {
	bindNavigationLinks,
	dropCommentsBetweenBlocks,
	insertedTemplates,
	storePresetValues,
	validateBlocks,
	type BlockLoss,
	type ValidationReport,
} from 'cli/ai/block-validator';
import { OpenProblems } from 'cli/ai/open-problems';

vi.mock( 'cli/ai/block-validator', async () => ( {
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
	blockNames: (
		await vi.importActual< typeof import('cli/ai/block-validator') >( 'cli/ai/block-validator' )
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

	it( "validates a pattern's markup and keeps its header in the fix", async () => {
		const header = '<?php\n/**\n * Title: Hello\n */\n?>\n';
		const file = write( 'wp-content/themes/t/patterns/hello.php', header + original );
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( validateBlocks ).toHaveBeenCalledWith( original, 'http://localhost:8881' );
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
			palette
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
		expect( bindNavigationLinks ).toHaveBeenLastCalledWith( original, 'http://localhost:8881' );
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
			'http://localhost:8881'
		);
		expect( storePresetValues ).toHaveBeenLastCalledWith( fixed, 'http://localhost:8881', {
			colors: [ [ 'accent-3', '#503AA8' ] ],
			fontSizes: [],
			spacingSizes: [],
		} );
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
		expect( validateBlocks ).toHaveBeenLastCalledWith( fixed, 'http://localhost:8881' );
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

	it( 'gates core/html policy before the editor runs, with what the editor inserts for the block it names', async () => {
		const file = write(
			'tmp/home.html',
			'<!-- wp:html --><form><input /></form><!-- /wp:html -->'
		);
		vi.mocked( insertedTemplates ).mockResolvedValueOnce( [ form ] );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain( 'core/html contains form markup' );
		expect( result.problem!.endsWith( insertsForm ) ).toBe( true );
		expect( insertedTemplates ).toHaveBeenLastCalledWith(
			[ 'jetpack/contact-form' ],
			'http://localhost:8881'
		);
		expect( validateBlocks ).not.toHaveBeenCalled();
	} );

	it( 'shows what the editor inserts for the blocks an unfixable block holds', async () => {
		const written =
			'<div class="wp-block-group"><!-- wp:jetpack/contact-form --><!-- wp:jetpack/field-name /--></div>';
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
		expect( ( await gate.settle() ).summaries ).toEqual( [ 'validated v2' ] );
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
