/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
import { vi } from 'vitest';
import { EditorPage } from 'cli/ai/browser-utils';
import { checkHtmlBlocks, cleanupCheckerPages } from '../html-block-checker';

// vi.mock is hoisted by vitest, so placement after imports is fine.
vi.mock( 'cli/ai/browser-utils', () => ( {
	getSharedBrowser: vi.fn(),
	EditorPage: vi.fn(),
} ) );

function setupMockEditorPage( blocks: any[] ) {
	const mockPage = {
		evaluate: vi.fn().mockImplementation( ( fn: Function, ...args: any[] ) => {
			( globalThis as any ).window = {
				...( globalThis as any ).window,
				wp: {
					blocks: {
						parse: () => blocks,
					},
				},
			};
			return fn( ...args );
		} ),
	};

	const MockEditorPage = vi.mocked( EditorPage );
	MockEditorPage.mockImplementation( function ( this: any ) {
		this.getPage = vi.fn().mockResolvedValue( mockPage );
		this.close = vi.fn().mockResolvedValue( undefined );
	} as any );

	return mockPage;
}

describe( 'checkHtmlBlocks', () => {
	afterEach( async () => {
		await cleanupCheckerPages();
		vi.restoreAllMocks();
		delete ( globalThis as any ).window?.wp;
	} );

	it( 'passes when there are no core/html blocks', async () => {
		setupMockEditorPage( [
			{
				name: 'core/paragraph',
				blockName: 'core/paragraph',
				originalContent: '<p>Hi</p>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks(
			'<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
			'http://localhost:8888'
		);

		expect( report.passed ).toBe( true );
		expect( report.htmlBlocks ).toBe( 0 );
		expect( report.problematicBlocks ).toBe( 0 );
		expect( report.issues ).toHaveLength( 0 );
	} );

	it( 'passes when HTML blocks only contain allowed wrapper tags (SVG, form, script)', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="50"/></svg>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<form action="/submit"><input type="text"/></form>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<script>console.log("hello")</script>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( true );
		expect( report.htmlBlocks ).toBe( 3 );
		expect( report.allowedBlocks ).toBe( 3 );
		expect( report.problematicBlocks ).toBe( 0 );
	} );

	it( 'allows HTML blocks wrapping non-convertible content (SVGs inside a div)', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent:
					'<div class="logo-grid"><svg viewBox="0 0 100 100"><circle/></svg><svg viewBox="0 0 50 50"><rect/></svg></div>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( true );
		expect( report.htmlBlocks ).toBe( 1 );
		expect( report.allowedBlocks ).toBe( 1 );
		expect( report.problematicBlocks ).toBe( 0 );
	} );

	it( 'flags HTML blocks with data-* attributes when content is otherwise convertible', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent:
					'<div class="counter"><span data-target="1500">0</span><span data-target="200">0</span></div>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.allowedBlocks ).toBe( 0 );
		expect( report.problematicBlocks ).toBe( 1 );
	} );

	it( 'allows HTML blocks wrapping canvas or iframe inside a div', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent:
					'<div class="animation-container"><canvas id="particles" width="800" height="600"></canvas></div>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( true );
		expect( report.allowedBlocks ).toBe( 1 );
	} );

	it( 'fails when an HTML block wraps purely convertible content', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<section><h2>Title</h2><p>Description text here.</p></section>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.problematicBlocks ).toBe( 1 );
		expect( report.issues[ 0 ].wrapperTag ).toBe( 'section' );
	} );

	it( 'fails for each convertible HTML block even if there is only one', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<p>This should be a core/paragraph block</p>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.problematicBlocks ).toBe( 1 );
		expect( report.issues[ 0 ].suggestedBlocks ).toEqual( [ 'core/paragraph' ] );
	} );

	it( 'fails with deep nesting on convertible content (depth >= 4)', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<div><div><div><div><p>Deeply nested</p></div></div></div></div>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.problematicBlocks ).toBe( 1 );
		expect( report.issues[ 0 ].reason ).toBe( 'deep_nesting' );
		expect( report.issues[ 0 ].maxDepth ).toBeGreaterThanOrEqual( 4 );
	} );

	it( 'provides correct replacement suggestions for different wrapper tags', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<section><p>Content</p></section>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<h2>Title</h2>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<ul><li>Item</li></ul>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<blockquote>Quote</blockquote>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<nav><a href="/">Home</a></nav>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		const issueMap = Object.fromEntries(
			report.issues.map( ( i ) => [ i.wrapperTag, i.suggestedBlocks ] )
		);

		expect( issueMap.section ).toEqual( [ 'core/group with tagName="section"' ] );
		expect( issueMap.h2 ).toEqual( [ 'core/heading with level=2' ] );
		expect( issueMap.ul ).toEqual( [ 'core/list' ] );
		expect( issueMap.blockquote ).toEqual( [ 'core/quote' ] );
		expect( issueMap.nav ).toEqual( [ 'core/navigation' ] );
	} );

	it( 'handles inner blocks containing core/html', async () => {
		setupMockEditorPage( [
			{
				name: 'core/group',
				blockName: 'core/group',
				originalContent: '<div class="wp-block-group"></div>',
				innerBlocks: [
					{
						name: 'core/html',
						blockName: 'core/html',
						originalContent: '<div><div><div><div><p>Nested in group</p></div></div></div></div>',
						innerBlocks: [],
					},
				],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.htmlBlocks ).toBe( 1 );
		expect( report.problematicBlocks ).toBe( 1 );
		expect( report.issues[ 0 ].wrapperTag ).toBe( 'div' );
	} );

	it( 'mixes allowed and problematic blocks correctly', async () => {
		setupMockEditorPage( [
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<div class="marquee"><span data-speed="fast">Logo</span></div>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<section><h2>About Us</h2><p>We are a team.</p></section>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.htmlBlocks ).toBe( 3 );
		expect( report.allowedBlocks ).toBe( 1 ); // svg only
		expect( report.problematicBlocks ).toBe( 2 ); // marquee (data-* no longer exempt) + section
		const wrapperTags = report.issues.map( ( i ) => i.wrapperTag );
		expect( wrapperTags ).toContain( 'div' ); // marquee div with data-* attrs
		expect( wrapperTags ).toContain( 'section' ); // pure structural content
	} );

	it( 'returns an error report when wp.blocks is not available', async () => {
		const mockPage = {
			evaluate: vi.fn().mockImplementation( ( fn: Function, ...args: any[] ) => {
				( globalThis as any ).window = {};
				return fn( ...args );
			} ),
		};

		vi.mocked( EditorPage ).mockImplementation( function ( this: any ) {
			this.getPage = vi.fn().mockResolvedValue( mockPage );
			this.close = vi.fn().mockResolvedValue( undefined );
		} as any );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.error ).toBe( 'wp.blocks is not available on this page.' );
	} );

	it( 'returns an error report when page evaluation throws', async () => {
		vi.mocked( EditorPage ).mockImplementation( function ( this: any ) {
			this.getPage = vi.fn().mockRejectedValue( new Error( 'Browser crashed' ) );
			this.close = vi.fn().mockResolvedValue( undefined );
		} as any );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.passed ).toBe( false );
		expect( report.error ).toContain( 'Browser crashed' );
	} );

	it( 'counts total blocks including non-HTML blocks', async () => {
		setupMockEditorPage( [
			{
				name: 'core/paragraph',
				blockName: 'core/paragraph',
				originalContent: '<p>Hi</p>',
				innerBlocks: [],
			},
			{
				name: 'core/html',
				blockName: 'core/html',
				originalContent: '<svg><circle/></svg>',
				innerBlocks: [],
			},
			{
				name: 'core/heading',
				blockName: 'core/heading',
				originalContent: '<h2>Title</h2>',
				innerBlocks: [],
			},
		] );

		const report = await checkHtmlBlocks( 'content', 'http://localhost:8888' );

		expect( report.totalBlocks ).toBe( 3 );
		expect( report.htmlBlocks ).toBe( 1 );
		expect( report.allowedBlocks ).toBe( 1 );
	} );
} );
