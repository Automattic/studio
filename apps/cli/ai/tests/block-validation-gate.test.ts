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
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';

vi.mock( 'cli/ai/block-validator', () => ( { validateBlocks: vi.fn() } ) );

let site: string;

function write( relativePath: string, content: string ) {
	const file = path.join( site, relativePath );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync( file, content );
	return file;
}

function invalidWithFix( fixedContent: string, fixValid = true ): ValidationReport {
	return {
		totalBlocks: 1,
		validBlocks: 0,
		invalidBlocks: 1,
		results: [
			{ blockName: 'core/paragraph', isValid: false, issues: [ 'mismatch' ], originalContent: '' },
		],
		proposedFix: {
			fixedContent,
			report: {
				totalBlocks: 1,
				validBlocks: fixValid ? 1 : 0,
				invalidBlocks: fixValid ? 0 : 1,
				results: [],
			},
		},
	};
}

beforeEach( () => {
	site = mkdtempSync( path.join( os.tmpdir(), 'studio-gate-' ) );
	vi.mocked( validateBlocks ).mockReset();
} );

afterEach( () => rmSync( site, { recursive: true, force: true } ) );

describe( 'block markup files', () => {
	it( 'covers theme templates, parts, and tmp page files only', () => {
		expect( isBlockMarkupFile( '/s/wp-content/themes/t/parts/header.html' ) ).toBe( true );
		expect( isBlockMarkupFile( '/s/wp-content/themes/t/templates/index.html' ) ).toBe( true );
		expect( isBlockMarkupFile( '/s/tmp/page-home.html' ) ).toBe( true );
		expect( isBlockMarkupFile( '/s/wp-content/themes/t/style.css' ) ).toBe( false );
		expect( isBlockMarkupFile( '/s/DESIGN.md' ) ).toBe( false );
	} );
} );

describe( 'validating a file', () => {
	const original = '<!-- wp:paragraph {"align":"center"} --><p>Hello</p><!-- /wp:paragraph -->';
	const fixed =
		'<!-- wp:paragraph {"align":"center"} -->\n<p class="has-text-align-center">Hello</p>\n<!-- /wp:paragraph -->';

	it( 'applies a lossless editor fix silently', async () => {
		const file = write( 'tmp/home.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue( invalidWithFix( fixed ) );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toBeUndefined();
		expect( result.summary ).toContain(
			'1/1 blocks valid; saved through the block editor, fixing 1 block(s)'
		);
		expect( readFileSync( file, 'utf8' ) ).toBe( fixed );
	} );

	it( 'refuses a fix that would drop classes, and says what to change', async () => {
		const file = write(
			'tmp/home.html',
			'<!-- wp:paragraph --><p class="eyebrow">Hello</p><!-- /wp:paragraph -->'
		);
		vi.mocked( validateBlocks ).mockResolvedValue(
			invalidWithFix( '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->' )
		);
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain( 'drop the classes eyebrow' );
		expect( result.problem ).toContain( 'className' );
		expect( readFileSync( file, 'utf8' ) ).toContain( 'class="eyebrow"' );
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

	it( 'refuses a fix that would change the text', async () => {
		const file = write( 'tmp/home.html', original );
		vi.mocked( validateBlocks ).mockResolvedValue(
			invalidWithFix( '<!-- wp:paragraph -->\n<p></p>\n<!-- /wp:paragraph -->' )
		);
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain( 'change the text' );
	} );

	it( 'gates core/html policy before the editor runs', async () => {
		const file = write(
			'tmp/home.html',
			'<!-- wp:html --><form><input /></form><!-- /wp:html -->'
		);
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toContain( 'core/html' );
		expect( validateBlocks ).not.toHaveBeenCalled();
	} );

	it( 'makes in-page links home-relative in template parts', async () => {
		const file = write(
			'wp-content/themes/t/parts/header.html',
			'<!-- wp:navigation-link {"label":"Menu","url":"#menu"} /-->'
		);
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.summary ).toContain( 'home-relative' );
		expect( readFileSync( file, 'utf8' ) ).toContain( '"url":"/#menu"' );
	} );
} );

describe( 'the gate', () => {
	const ok = ( summary: string, content: string ) => ( {
		contentHash: createHash( 'sha1' ).update( content ).digest( 'hex' ),
		summary,
	} );

	it( 'reports each validated file once, and revalidates a file that changed', async () => {
		const file = write( 'tmp/home.html', 'v1' );
		const validateFile = vi.fn( async ( filePath: string ) =>
			ok( `validated ${ readFileSync( filePath, 'utf8' ) }`, readFileSync( filePath, 'utf8' ) )
		);
		const gate = new BlockValidationGate( validateFile );
		gate.track( file, site );
		writeFileSync( file, 'v2' );
		expect( ( await gate.settle() ).summaries ).toEqual( [ 'validated v2' ] );
		expect( ( await gate.settle() ).summaries ).toEqual( [] );
		gate.invalidate();
		expect( ( await gate.settle() ).summaries ).toEqual( [ 'validated v2' ] );
	} );

	it( 'refuses post content from a file anywhere in the site', async () => {
		write( 'home-content.html', 'bad' );
		const validateFile = vi.fn( async () => ( {
			...ok( 'home-content.html: 1 invalid block(s)', 'bad' ),
			problem: 'fix it',
		} ) );
		const gate = new BlockValidationGate( validateFile );
		expect(
			await gate.checkCommand( 'post create home-content.html --post_type=page', site )
		).toEqual( [ 'fix it' ] );
		expect(
			await gate.checkCommand( `post update 5 ${ path.join( site, 'home-content.html' ) }`, site )
		).toEqual( [ 'fix it' ] );
		expect( validateFile ).toHaveBeenCalledTimes( 1 );
		expect( await gate.checkCommand( 'option update blogname home-content.html', site ) ).toEqual(
			[]
		);
	} );

	it( 'refuses post content that opens as JSON but does not parse', async () => {
		const validateFile = vi.fn();
		const gate = new BlockValidationGate( validateFile );
		const broken = `post update 5 --post_content='{"version":3,"styles":{"color":{}}'`;
		const [ problem ] = await gate.checkCommand( broken, site );
		expect( problem ).toMatch( /^--post_content is not valid JSON/ );
		write( 'styles.json', '{"version":3}' );
		expect( await gate.checkCommand( 'post update 5 styles.json', site ) ).toEqual( [] );
		expect(
			await gate.checkCommand( `post update 5 --post_content='{"version":3}'`, site )
		).toEqual( [] );
		expect( validateFile ).not.toHaveBeenCalled();
	} );

	it( 'sends inline block markup to a file, where it is validated', async () => {
		const gate = new BlockValidationGate( vi.fn() );
		const command =
			"post create --post_type=page --post_content='<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'";
		const [ problem ] = await gate.checkCommand( command, site );
		expect( problem ).toContain( 'post create tmp/<name>.html' );
		expect( await gate.checkCommand( "post update 5 --post_content='Plain text'", site ) ).toEqual(
			[]
		);
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
