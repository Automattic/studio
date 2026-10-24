import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { PostContentCheck } from 'cli/ai/post-content-check';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/ai/block-validator', () => ( { validateBlocks: vi.fn() } ) );

const PARAGRAPH = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';
const UNWRAPPED_GROUP = '<!-- wp:group -->\n<p>Hello</p>\n<!-- /wp:group -->';
const WRAPPED_GROUP =
	'<!-- wp:group -->\n<div class="wp-block-group"><p>Hello</p></div>\n<!-- /wp:group -->';
const HTML_ONLY = '<!-- wp:html -->\n<div class="hero"><h1>Hello</h1></div>\n<!-- /wp:html -->';

const valid: ValidationReport = { totalBlocks: 1, validBlocks: 1, invalidBlocks: 0, results: [] };
const losslessFix: ValidationReport = {
	totalBlocks: 1,
	validBlocks: 0,
	invalidBlocks: 1,
	results: [
		{ blockName: 'core/group', isValid: false, issues: [ 'mismatch' ], originalContent: '' },
	],
	proposedFix: { fixedContent: WRAPPED_GROUP, report: valid },
};

let fixture: ReturnType< typeof createSite >;
let site: SiteData;

beforeEach( () => {
	fixture = createSite();
	fixture.save( 9, 'page', 'home', PARAGRAPH );
	site = { id: '1', name: 'Bakery', path: fixture.root, port: 8881 } as SiteData;
	vi.mocked( validateBlocks ).mockReset().mockResolvedValue( valid );
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

describe( 'PostContentCheck', () => {
	it.each( [
		{ name: 'an unchanged site', change: () => {}, reported: [] },
		{
			name: 'an edited page',
			change: () => fixture.edit( 9, PARAGRAPH + PARAGRAPH ),
			reported: [ 'Bakery page 9 "": 1/1 blocks valid' ],
		},
		{
			name: 'a new template part',
			change: () => fixture.save( 10, 'wp_template_part', 'header', PARAGRAPH ),
			reported: [ 'Bakery wp_template_part 10 "": 1/1 blocks valid' ],
		},
		{
			name: 'content WordPress does not render as a page',
			change: () => {
				fixture.save( 11, 'attachment', 'photo', PARAGRAPH );
				fixture.save( 12, 'page', 'draft', PARAGRAPH, 1, 'auto-draft' );
				fixture.save( 13, 'revision', 'home-revision', PARAGRAPH, 1, 'inherit' );
			},
			reported: [],
		},
	] )( 'reports what a call changed: $name', async ( { change, reported } ) => {
		const check = new PostContentCheck( new Map(), async () => [ site ] );
		await check.snapshot();
		change();
		expect( ( await check.settle() ).summaries ).toEqual( reported );
		// Reported once: the check moves its snapshot on.
		expect( ( await check.settle() ).summaries ).toEqual( [] );
	} );

	it( 'reports nothing for a site it has not seen before', async () => {
		const check = new PostContentCheck( new Map(), async () => [ site ] );
		fixture.edit( 9, HTML_ONLY );
		expect( await check.settle() ).toEqual( { summaries: [], problems: [] } );
	} );

	it( 'asks for editable blocks in place of core/html', async () => {
		const check = new PostContentCheck( new Map(), async () => [ site ] );
		await check.snapshot();
		fixture.edit( 9, HTML_ONLY );
		const { problems } = await check.settle();
		expect( problems.join( '\n' ) ).toContain( '1 core/html block(s) must become editable blocks' );
		expect( validateBlocks ).not.toHaveBeenCalled();
	} );

	it( 'saves a lossless editor fix next to the site, with the command that applies it', async () => {
		vi.mocked( validateBlocks ).mockResolvedValue( losslessFix );
		const check = new PostContentCheck( new Map(), async () => [ site ] );
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		const { summaries, problems } = await check.settle();
		expect( summaries ).toEqual( [ 'Bakery page 9 "": 1 invalid block(s)' ] );
		expect( problems[ 0 ] ).toContain( 'Apply it with `wp post update 9 tmp/page-9.html`' );
		expect( readFileSync( path.join( fixture.root, 'tmp/page-9.html' ), 'utf8' ) ).toBe(
			WRAPPED_GROUP
		);
	} );

	it( 'reports a validation that cannot run', async () => {
		vi.mocked( validateBlocks ).mockRejectedValue( new Error( 'site is not running' ) );
		const check = new PostContentCheck( new Map(), async () => [ site ] );
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		expect( ( await check.settle() ).summaries ).toEqual( [
			'Bakery page 9: not validated (site is not running)',
		] );
		expect( existsSync( path.join( fixture.root, 'tmp' ) ) ).toBe( false );
	} );
} );
