import { existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storePresetValues, validateBlocks, type ValidationReport } from 'cli/ai/block-validator';
import { postContentChanges } from 'cli/ai/post-content-check';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { SiteData } from 'cli/lib/cli-config/core';

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
	blocksSavingElements: vi.fn( async () => [] ),
	blockNames: (
		await vi.importActual< typeof import('cli/ai/block-validator') >( 'cli/ai/block-validator' )
	).blockNames,
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
// WP-CLI saves the file the PHP names to the post it names, as wp_update_post() would.
vi.mock( 'cli/lib/run-wp-cli-command', () => ( { runWpCliCommand: vi.fn() } ) );
vi.mock( 'cli/ai/theme-presets', () => ( {
	themePresets: vi.fn( async () => ( { colors: [ [ 'accent-3', '#503AA8' ] ] } ) ),
} ) );

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
	proposedFix: { fixedContent: WRAPPED_GROUP, report: valid, losses: [] },
};

let fixture: ReturnType< typeof createSite >;
let site: SiteData;

beforeEach( () => {
	fixture = createSite();
	fixture.save( 9, 'page', 'home', PARAGRAPH );
	site = { id: '1', name: 'Bakery', path: fixture.root, port: 8881 } as SiteData;
	vi.mocked( validateBlocks ).mockReset().mockResolvedValue( valid );
	saves( true );
} );

// WP-CLI runs `wp eval` with the PHP Studio passes, saving the file it names
// to the post it names, or failing.
function saves( works: boolean ) {
	vi.mocked( runWpCliCommand )
		.mockReset()
		.mockImplementation( async ( _site, args ) => {
			const php = args[ 1 ];
			const [ , id, file ] = php.match( /'ID' => (\d+)[\s\S]*file_get_contents\( "([^"]+)"/ )!;
			expect( php ).toContain( 'kses_remove_filters();' );
			if ( works ) {
				fixture.edit( Number( id ), readFileSync( file, 'utf8' ) );
			}
			return {
				response: { exitCode: Promise.resolve( works ? 0 : 1 ) },
				[ Symbol.asyncDispose ]: async () => {},
			} as unknown as Awaited< ReturnType< typeof runWpCliCommand > >;
		} );
}

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

const checkPosts = () => new SiteChanges( undefined, async () => [ site ], [ postContentChanges ] );

describe( 'post content changes', () => {
	it.each( [
		{ name: 'an unchanged site', change: () => {}, reported: [] },
		{
			name: 'an edited page',
			change: () => fixture.edit( 9, PARAGRAPH + PARAGRAPH ),
			reported: [ 'Block validation: Bakery page 9 "": 1/1 blocks valid' ],
		},
		{
			name: 'a new template part',
			change: () => fixture.save( 10, 'wp_template_part', 'header', PARAGRAPH ),
			reported: [ 'Block validation: Bakery wp_template_part 10 "": 1/1 blocks valid' ],
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
		const check = checkPosts();
		await check.snapshot();
		change();
		expect( ( await check.settle() ).summaries ).toEqual( reported );
		// Reported once: the check moves its snapshot on.
		expect( ( await check.settle() ).summaries ).toEqual( [] );
	} );

	it( 'reports nothing for a site it has not seen before', async () => {
		const check = checkPosts();
		fixture.edit( 9, HTML_ONLY );
		expect( await check.settle() ).toEqual( { summaries: [], problems: [], written: [] } );
	} );

	it( 'asks for editable blocks in place of core/html', async () => {
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, HTML_ONLY );
		const { problems } = await check.settle();
		expect( problems.join( '\n' ) ).toContain( '1 core/html block(s) must become editable blocks' );
		// The editor still validates the rest.
		expect( validateBlocks ).toHaveBeenCalled();
	} );

	it( 'saves a lossless editor fix to the post, and compares the post from it', async () => {
		vi.mocked( validateBlocks ).mockResolvedValue( losslessFix );
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		expect( await check.settle() ).toEqual( {
			summaries: [
				'Block validation: Bakery page 9 "": Studio saved the block editor\'s save of it, which fixes 1 block(s) that do not match what the block saves, losing nothing, so it now holds what the editor saves',
			],
			problems: [],
			written: [],
		} );
		expect( fixture.content( 9 ) ).toBe( WRAPPED_GROUP );
		expect( existsSync( path.join( fixture.root, 'tmp/page-9.html' ) ) ).toBe( false );
		// What Studio saved is not checked again.
		expect( ( await check.settle() ).summaries ).toEqual( [] );
	} );

	it( 'saves a lossless editor fix next to the site, with the command that applies it, when it cannot save it', async () => {
		saves( false );
		vi.mocked( validateBlocks ).mockResolvedValue( losslessFix );
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		const { summaries, problems } = await check.settle();
		expect( summaries ).toEqual( [ 'Block validation: Bakery page 9 "": 1 invalid block(s)' ] );
		expect( problems[ 0 ] ).toContain(
			`Apply it in the site's folder with \`wp post update 9 ${ fixture.root
				.split( path.sep )
				.join( '/' ) }/tmp/page-9.html\``
		);
		expect( readFileSync( path.join( fixture.root, 'tmp/page-9.html' ), 'utf8' ) ).toBe(
			WRAPPED_GROUP
		);
	} );

	it( 'names the blocks the saved fix keeps as written', async () => {
		vi.mocked( validateBlocks ).mockResolvedValue( {
			...losslessFix,
			invalidBlocks: 2,
			results: [
				{ ...losslessFix.results[ 0 ], place: '/0' },
				{ ...losslessFix.results[ 0 ], place: '/1', issues: [ 'sticky' ] },
			],
			proposedFix: {
				...losslessFix.proposedFix!,
				losses: [
					{ place: '/1', blockName: 'core/group', lost: 'drop the styles position:sticky' },
				],
			},
		} );
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		const { summaries, problems } = await check.settle();
		expect( summaries[ 0 ] ).toContain( "Studio saved the block editor's save of it" );
		expect( fixture.content( 9 ) ).toBe( WRAPPED_GROUP );
		expect( problems[ 0 ] ).toContain(
			"core/group: the editor's fix would drop the styles position:sticky; sticky"
		);
	} );

	it( "saves the content with the palette's colors stored as presets", async () => {
		const PRESET = '<!-- wp:group {"backgroundColor":"accent-3"} -->';
		vi.mocked( storePresetValues ).mockResolvedValueOnce( {
			content: PRESET,
			colors: [ { color: '#503AA8', slug: 'accent-3' } ],
			fontSizes: [],
			spacingSizes: [],
		} );
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		const { summaries, problems } = await check.settle();
		expect( storePresetValues ).toHaveBeenLastCalledWith(
			UNWRAPPED_GROUP,
			'http://localhost:8881',
			{ colors: [ [ 'accent-3', '#503AA8' ] ], fontSizes: [], spacingSizes: [] }
		);
		expect( problems ).toEqual( [] );
		expect( summaries ).toEqual( [
			`Block validation: Bakery page 9 "": Studio saved the block editor's save of it, which stores #503AA8 as the palette's accent-3, as the editor stores a palette color (encodeColorValueWithPalette in @wordpress/block-editor), so it follows the palette, losing nothing, so it now holds what the editor saves`,
		] );
		expect( fixture.content( 9 ) ).toBe( PRESET );
	} );

	it( 'reports a validation that cannot run', async () => {
		vi.mocked( validateBlocks ).mockRejectedValue( new Error( 'site is not running' ) );
		const check = checkPosts();
		await check.snapshot();
		fixture.edit( 9, UNWRAPPED_GROUP );
		expect( ( await check.settle() ).summaries ).toEqual( [
			'Block validation: Bakery page 9: not validated (site is not running)',
		] );
		expect( existsSync( path.join( fixture.root, 'tmp' ) ) ).toBe( false );
	} );
} );
