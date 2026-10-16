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

	it( 'keeps valid markup whose re-serialization would drop an attribute', async () => {
		const written =
			'<!-- wp:group {"layout":{"type":"constrained"}} --><div class="wp-block-group"></div><!-- /wp:group -->';
		const file = write( 'tmp/home.html', written );
		vi.mocked( validateBlocks ).mockResolvedValue( {
			totalBlocks: 1,
			validBlocks: 1,
			invalidBlocks: 0,
			results: [],
			proposedFix: {
				fixedContent: '<!-- wp:group -->\n<div class="wp-block-group"></div>\n<!-- /wp:group -->',
				report: { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] },
			},
		} );
		const result = await validateBlockMarkupFile( file, 'http://localhost:8881' );
		expect( result.problem ).toBeUndefined();
		expect( readFileSync( file, 'utf8' ) ).toBe( written );
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

	it( 'names open problems for commands that read the file', async () => {
		const file = write( 'tmp/home.html', 'bad' );
		const gate = new BlockValidationGate( async () => ( {
			...ok( 'tmp/home.html: 1 invalid block(s)', 'bad' ),
			problem: 'fix it',
		} ) );
		gate.track( file, site );
		expect( ( await gate.settle() ).problems ).toEqual( [ 'fix it' ] );
		expect( gate.openProblemsIn( 'post create tmp/home.html --post_type=page' ) ).toEqual( [
			'fix it',
		] );
		expect( gate.openProblemsIn( 'option update blogname X' ) ).toEqual( [] );
	} );

	it( 'ignores files that are not block markup', async () => {
		const validateFile = vi.fn();
		const gate = new BlockValidationGate( validateFile );
		gate.track( write( 'wp-content/themes/t/style.css', '' ), site );
		expect( validateFile ).not.toHaveBeenCalled();
	} );
} );
