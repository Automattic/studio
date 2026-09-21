import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CAPTURED_INTERACTIONS_SCHEMA,
	CAPTURE_RECEIPT_SCHEMA,
	ASSET_EVIDENCE_SCHEMA,
	documentsDiffer,
	exportWebsiteCapture,
	INDEXED_SEMANTIC_EVIDENCE_SCHEMA,
	portableInlineStyle,
} from './capture-export.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';
import { cleanupPolicy } from './source-cleanup.js';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

describe( 'exportWebsiteCapture', () => {
	it( 'preserves the 360 Chiropractic BlogPosting as standard document JSON-LD', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-publication-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<main><article>Ordinary article page</article></main>' );
		writeFileSync(
			join( outputDir, 'html', 'publication.html' ),
			readFileSync( fileURLToPath( new URL( '../../test/fixtures/360chiro-publication-metadata.html', import.meta.url ) ), 'utf8' )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://www.360chiro.co.uk/': { slug: 'homepage', html: 'html/homepage.html' },
					'https://www.360chiro.co.uk/post/can-chiropractic-help-with-back-pain-360-chiro-clinic-sheffield': { slug: 'publication', html: 'html/publication.html' },
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://www.360chiro.co.uk/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load(
			readFileSync(
				join( outputDir, 'website', 'post', 'can-chiropractic-help-with-back-pain-360-chiro-clinic-sheffield', 'index.html' ),
				'utf8'
			)
		);
		const jsonLd = $( 'head script[type="application/ld+json"]' );
		expect( jsonLd ).toHaveLength( 1 );
		expect( JSON.parse( jsonLd.text() ) ).toMatchObject( {
			'@context': 'https://schema.org',
			'@type': 'BlogPosting',
			datePublished: '2026-08-24T12:49:28.000Z',
		} );
	} );

	it( 'preserves arbitrary Article JSON-LD without enabling source scripts', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-json-ld-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<script>globalThis.executed = true</script><script type="application/ld+json">"source-only-primitive"</script><script type="application/ld+json; charset=utf-8">{"@context":"https://schema.org","@type":"Article","datePublished":"2025-01-02T03:04:05Z","description":"\\u003C/script>\\u003Cscript>globalThis.executed = true\\u003C/script>"}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","mainEntity":{"@type":"Article","datePublished":"2024-05-06T07:08:09Z"}}</script><main>Article</main>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const page = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( page ).toContain( 'application/ld+json' );
		const $ = cheerio.load( page );
		const jsonLd = $( 'script[type="application/ld+json"]' );
		expect( jsonLd ).toHaveLength( 2 );
		expect( JSON.parse( jsonLd.first().text() ) ).toMatchObject( {
			'@type': 'Article', datePublished: '2025-01-02T03:04:05Z',
		} );
		expect( JSON.parse( jsonLd.last().text() ) ).toMatchObject( {
			'@type': 'WebPage', mainEntity: { '@type': 'Article', datePublished: '2024-05-06T07:08:09Z' },
		} );
		expect( page ).toContain( '<\\/script>' );
		expect( page ).not.toContain( '<script>globalThis.executed = true</script>' );
		expect( page ).not.toContain( 'source-only-primitive' );
	} );

	it( 'bounds inert JSON-LD before parsing and preserves only accepted objects', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-json-ld-bounds-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const emptyDocument = JSON.stringify( { description: '' } );
		const atScriptLimit = JSON.stringify( {
			description: 'x'.repeat( 64 * 1024 - Buffer.byteLength( emptyDocument ) ),
		} );
		const oversized = JSON.stringify( { oversized: 'x'.repeat( 64 * 1024 ) } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			[
				`<script type="application/ld+json">${ oversized }</script>`,
				...Array.from(
					{ length: 4 },
					() => `<script type="application/ld+json">${ atScriptLimit }</script>`
				),
				'<script type="application/ld+json">{"overTotal":true}</script>',
			].join( '' )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const jsonLd = cheerio.load( html )( 'script[type="application/ld+json"]' );
		expect( jsonLd ).toHaveLength( 4 );
		expect( html ).not.toContain( 'oversized' );
		expect( html ).not.toContain( 'overTotal' );
		for ( const script of jsonLd.toArray() ) {
			expect( Buffer.byteLength( cheerio.load( script ).text() ) ).toBe( 64 * 1024 );
		}
	} );

	it( 'retains no more than sixteen inert JSON-LD scripts', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-json-ld-count-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			Array.from(
				{ length: 17 },
				( _, index ) => `<script type="application/ld+json">{"index":${ index }}</script>`
			).join( '' )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const jsonLd = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) )(
			'script[type="application/ld+json"]'
		);
		expect( jsonLd ).toHaveLength( 16 );
		expect( JSON.parse( jsonLd.last().text() ) ).toEqual( { index: 15 } );
	} );
	it( 'writes responsive section evidence as a neutral sidecar', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-semantic-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<main><h1>Tianna Wolfson</h1><img src="portrait.jpg"></main>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		const spec = {
			selector: 'main > section',
			headings: [ 'Tianna Wolfson' ],
			images: [],
			layout: {},
			sectionHtml: `<section>${ 'source'.repeat( 100_000 ) }</section>`,
			styledHtml: `<section style="color:red">${ 'styled'.repeat( 100_000 ) }</section>`,
		} as never;
		const specs = Array.from( { length: 5 }, () => spec );
		SectionSpecsStore.load( outputDir ).set( 'https://example.com/', specs, [] );
		SectionSpecsStore.loadMobile( outputDir ).set( 'https://example.com/', specs, [] );

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const index = JSON.parse( readFileSync( join( outputDir, 'semantic-evidence.index.json' ), 'utf8' ) );
		const evidence = JSON.parse( readFileSync( join( outputDir, index.shards[ 0 ].path ), 'utf8' ) );
		expect( index ).toMatchObject( { schema: INDEXED_SEMANTIC_EVIDENCE_SCHEMA, page_count: 1 } );
		expect( evidence.pages[ 0 ].path ).toBe( 'website/index.html' );
		expect( evidence.pages[ 0 ].viewports.desktop ).toHaveLength( 5 );
		expect( evidence.pages[ 0 ].viewports.mobile ).toHaveLength( 5 );
		expect( evidence.pages[ 0 ].viewports.desktop[ 0 ] ).toMatchObject( {
			headings: [ 'Tianna Wolfson' ],
		} );
		for ( const sections of Object.values( evidence.pages[ 0 ].viewports ) as Array<
			Record< string, unknown >[]
		> ) {
			for ( const section of sections ) {
				expect( section ).not.toHaveProperty( 'sectionHtml' );
				expect( section ).not.toHaveProperty( 'styledHtml' );
			}
		}
	} );

	it( 'retains the HTML-only fallback when section evidence is invalid', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-invalid-semantic-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<main><h1>Captured fallback</h1></main>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		SectionSpecsStore.load( outputDir ).set( 'https://example.com/', [ {} as never ], [] );

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		expect( existsSync( join( outputDir, 'semantic-evidence.index.json' ) ) ).toBe( false );
	} );

	it( 'measures UTF-8 semantic evidence shards at the exact file limit', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-semantic-byte-limit-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<main>Home</main>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);
		const maxFileBytes = 10 * 1024 * 1024;
		const page = {
			path: 'website/index.html',
			url: 'https://example.com/',
			viewports: { desktop: [ { selector: 'main', heading: '🍜', content: '' } ] },
		};
		const emptyBytes = Buffer.byteLength(
			`${ JSON.stringify( { schema: INDEXED_SEMANTIC_EVIDENCE_SCHEMA, pages: [ page ] } ) }\n`
		);
		page.viewports.desktop[ 0 ].content = 'x'.repeat( maxFileBytes - emptyBytes );
		SectionSpecsStore.load( outputDir ).set(
			'https://example.com/',
			page.viewports.desktop as never,
			[]
		);

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const index = JSON.parse( readFileSync( join( outputDir, 'semantic-evidence.index.json' ), 'utf8' ) );
		const shard = readFileSync( join( outputDir, index.shards[ 0 ].path ), 'utf8' );
		expect( Buffer.byteLength( shard ) ).toBe( maxFileBytes );
		expect( shard ).toContain( '🍜' );
	} );

	it( 'exports hash-bound geometry proof without runtime capture markers', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-geometry-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'layout-geometry' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main><div data-dla-geometry-id="wrapper-0"><section data-dla-geometry-id="target-0">Copy</section></div></main></body></html>'
		);
		const observation = ( viewport: number ) => ( {
			wrapperIdentity: 'wrapper-0',
			targetIdentity: 'target-0',
			viewport,
			state: 'default',
			wrapper: { x: 0, y: 0, width: 100, height: 24 },
			target: { x: 0, y: 0, width: 100, height: 24 },
			simulated: { x: 0, y: 0, width: 100, height: 24 },
			facts: { display: 'block', position: 'static', visibility: 'visible', childCount: 1 },
			invariants: { runtime: true, semantics: true },
		} );
		for ( const [ viewport, width ] of [
			[ 'desktop', 1440 ],
			[ 'mobile', 390 ],
		] as const )
			writeFileSync(
				join( outputDir, 'layout-geometry', `homepage.${ viewport }.json` ),
				JSON.stringify( {
					schema: 'data-liberation/layout-geometry-capture/v1',
					observations: [ observation( width ) ],
					omissions: {},
				} )
			);
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );
		const proof = JSON.parse( readFileSync( join( outputDir, 'layout-geometry-proof.json' ), 'utf8' ) );
		expect( proof ).toMatchObject( {
			schema: 'data-liberation/layout-geometry-proof/v1',
			nodes: [
				{ selector: 'main:nth-of-type(1) > div:nth-of-type(1)' },
				{ selector: 'main:nth-of-type(1) > div:nth-of-type(1) > section:nth-of-type(1)' },
			],
			reductions: [
				{ invariants: { selectors: true, runtime: true, semantics: true, viewports: true } },
			],
		} );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'data-dla-geometry-id'
		);
	} );

	it( 'keeps responsive runtime anchor targets unique and diagnoses unresolved fragments', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-responsive-anchor-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><a href="https://example.com/#features" data-dla-anchor-fragment="features">Features</a><a href="https://example.com/#missing" data-dla-anchor-fragment="missing" data-dla-anchor-unresolved="runtime scroll did not resolve to a section boundary">Missing</a><span id="features" data-dla-anchor-target="features" data-dla-anchor-source-id="feature-section"></span><section id="feature-section">Desktop features</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><a href="https://example.com/#features" data-dla-anchor-fragment="features">Features</a><a href="https://example.com/#testimonial" data-dla-anchor-fragment="testimonial">Testimonial</a><article id="testimonial">Mobile testimonial</article><section id="feature-section">Mobile features</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'wix',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( $( '#features' ) ).toHaveLength( 1 );
		expect( $( '#features--dla-mobile' ) ).toHaveLength( 1 );
		expect( $( '.data-liberation-desktop-document a' ).first().attr( 'href' ) ).toBe(
			'/index.html#features'
		);
		expect( $( '.data-liberation-mobile-document a' ).first().attr( 'href' ) ).toBe(
			'/index.html#features--dla-mobile'
		);
		expect( $( '#testimonial--dla-mobile' ) ).toHaveLength( 1 );
		expect( $( '.data-liberation-mobile-document a' ).eq( 1 ).attr( 'href' ) ).toBe(
			'/index.html#testimonial--dla-mobile'
		);
		expect(
			JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedAnchors
		).toEqual( [
			{
				sourceUrl: 'https://example.com/',
				fragment: 'missing',
				targetCount: 0,
				reason: 'runtime scroll did not resolve to a section boundary',
			},
		] );
	} );

	it( 'diagnoses an ordinary authored same-page anchor with no matching target', () => {
		// Regression for a truncated SPA capture: a nav link like
		// `<a href="#releases">` ships unmarked by any adapter (no
		// `data-dla-anchor-fragment`) — this is what an entire dropped section
		// looks like when the deferred content never rendered before the
		// snapshot. The receipt must surface it instead of reporting a clean
		// capture.
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-bare-anchor-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><nav><a href="#releases">Releases</a><a href="#listen">Listen</a></nav><section id="listen">Listen</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		expect(
			JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedAnchors
		).toEqual( [
			{
				sourceUrl: 'https://example.com/',
				fragment: 'releases',
				targetCount: 0,
				reason: 'captured fragment target is missing',
			},
		] );
	} );

	it( 'does not flag a resolvable same-page anchor or a captured cross-route fragment link', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-ok-anchor-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><a href="#listen">Listen</a><a href="/about/#team">Team</a><section id="listen">Listen</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			'<html><body><section id="team">Team</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about/': { html: 'html/about.html' },
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		expect(
			JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedAnchors
		).toEqual( [] );
	} );

	it( 'names same-origin anchors whose target route was never captured', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-uncaptured-route-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><nav><a href="/blog">Blog</a><a href="/contact">Contact</a></nav><main><a href="/hyundai-i30n">Post</a><a href="/using-hyper-key-skhd-app-switching-mac">Another</a></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: { routesDiscovered: 1, routesCaptured: 1, routesFailed: 0 },
			failures: [],
		} );

		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.unresolvedAnchors ).toEqual( [
			{
				sourceUrl: 'https://example.com/',
				url: 'https://example.com/blog',
				reason: 'target route was not captured',
			},
			{
				sourceUrl: 'https://example.com/',
				url: 'https://example.com/contact',
				reason: 'target route was not captured',
			},
			{
				sourceUrl: 'https://example.com/',
				url: 'https://example.com/hyundai-i30n',
				reason: 'target route was not captured',
			},
			{
				sourceUrl: 'https://example.com/',
				url: 'https://example.com/using-hyper-key-skhd-app-switching-mac',
				reason: 'target route was not captured',
			},
		] );
		expect( diagnostics.complete ).toBe( false );
		expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).summary.complete ).toBe( false );
	} );

	it( 'declares responsive editing counterparts from stable source component slots', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-responsive-counterparts-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main><section id="hero"><h1>Desktop title</h1><a href="/quote">Quote</a></section><p>Unproven equal copy</p><div id="duplicate"><p>First</p></div><div id="duplicate"><p>Second</p></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><main><section id="hero"><div><h1>Mobile title</h1></div><div><a href="/quote">Quote mobile</a></div></section><p>Unproven equal copy</p><div id="duplicate"><p>First</p></div><div id="duplicate"><p>Second</p></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		for ( const selector of [ 'h1', 'a' ] ) {
			const desktop = $( `.data-liberation-desktop-document ${ selector }` );
			const mobile = $( `.data-liberation-mobile-document ${ selector }` );
			const desktopToken = ( desktop.attr( 'class' ) ?? '' )
				.split( /\s+/ )
				.find( ( name ) => name.startsWith( 'data-liberation-responsive-counterpart-' ) );
			expect( desktopToken ).toMatch( /^data-liberation-responsive-counterpart-[a-f0-9]{12}$/ );
			expect( mobile.hasClass( desktopToken! ) ).toBe( true );
			expect( mobile.attr( 'data-dla-responsive-source' ) ).toBe(
				desktop.attr( 'data-dla-responsive-source' )
			);
		}
		expect( $( '.data-liberation-desktop-document main > p, .data-liberation-mobile-document main > p' ) ).toHaveLength( 2 );
		expect( $( 'main > p[class*="responsive-counterpart"]' ) ).toHaveLength( 0 );
		expect( $( '#duplicate p[class*="responsive-counterpart"]' ) ).toHaveLength( 0 );
	} );

	it( 'switches documents at the width the source stops adapting at, not a hardcoded one', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-detected-switch-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><style>.desktop{color:blue}</style></head><body><main>Desktop</main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><head><style>.mobile{color:red}:root .device-mobile-responsive.responsive{display:revert!important}</style></head><body class="device-mobile-responsive responsive"><main>Mobile</main><nav>Menu</nav></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': {
						html: 'html/homepage.html',
						// Learned during capture: this document stops shrinking at 980px.
						fluid: {
							applied: 12,
							unmodelled: 3,
							breakpoints: [ 1024 ],
							canvasFloor: 980,
							byKind: { floored: 12, breakpoint: 3 },
						},
					},
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( '@media(max-width:980px)' );
		expect( html ).toContain( '<style media="(min-width:981px)">.desktop{color:blue}</style>' );
		const sourceVisibilityOverride = html.indexOf( 'display:revert!important' );
		const authoritativeSwitch = html.lastIndexOf(
			'.data-liberation-mobile-document{display:none!important}'
		);
		expect( sourceVisibilityOverride ).toBeGreaterThanOrEqual( 0 );
		expect( authoritativeSwitch ).toBeGreaterThan( sourceVisibilityOverride );
		expect( html ).not.toContain( '768px' );
		expect( html ).not.toContain( '769px' );

		const profile = JSON.parse( readFileSync( join( outputDir, 'source-profile.json' ), 'utf8' ) );
		expect( profile ).toMatchObject( {
			schema: 'data-liberation/source-profile/v1',
			variants: 'per-device',
			geometry: 'mixed',
			switchWidth: 980,
			switchWidthSource: 'detected',
			breakpoints: [ 1024 ],
		} );
	} );

	it( 'falls back to the default switch width when nothing was detected', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-default-switch-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><style>.desktop{color:blue}</style></head><body><main>Desktop</main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><head><style>.mobile{color:red}</style></head><body><main>Mobile</main><nav>Menu</nav></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'@media(max-width:768px)'
		);
		const profile = JSON.parse( readFileSync( join( outputDir, 'source-profile.json' ), 'utf8' ) );
		expect( profile ).toMatchObject( { switchWidth: null, switchWidthSource: 'default' } );
	} );

	it( 'binds viewport-scoped geometry identities to the exact marker-free responsive output', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-responsive-geometry-export-' ) );
		dirs.push( outputDir );
		for ( const path of [
			'html',
			'html-mobile',
			'layout-geometry',
			'resources/cdn',
			'screenshots',
		] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><link rel="stylesheet" href="https://cdn.example/site.css"><style>.desktop{display:block}</style></head><body class="responsive desktop-body" style="margin:3px;padding:4px"><main><div data-dla-geometry-id="desktop-wrapper-0" onclick="discard()"><section data-dla-geometry-id="desktop-target-0">Desktop<a href="javascript:discard()">Unsafe</a><form action="https://evil.example/"><button formaction="javascript:discard()">Send</button></form><iframe src="https://evil.example/"></iframe></section></div><script>discard()</script></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><head><style>.mobile{display:block}</style></head><body class="responsive mobile-body" style="margin:5px;padding:6px"><main><div data-dla-geometry-id="mobile-wrapper-0"><section data-dla-geometry-id="mobile-target-0">Mobile</section></div></main></body></html>'
		);
		const observation = ( viewport: number, identity: string ) => ( {
			wrapperIdentity: `${ identity }-wrapper-0`,
			targetIdentity: `${ identity }-target-0`,
			viewport,
			state: 'default' as const,
			wrapper: { x: 0, y: 0, width: 100, height: 24 },
			target: { x: 0, y: 0, width: 100, height: 24 },
			simulated: { x: 0, y: 0, width: 100, height: 24 },
			facts: { display: 'block', position: 'static', visibility: 'visible', childCount: 1 },
			invariants: { runtime: true, semantics: true },
		} );
		writeFileSync(
			join( outputDir, 'layout-geometry', 'homepage.desktop.json' ),
			JSON.stringify( {
				schema: 'data-liberation/layout-geometry-capture/v1',
				observations: [ observation( 1440, 'desktop' ) ],
				omissions: {},
			} )
		);
		writeFileSync(
			join( outputDir, 'layout-geometry', 'homepage.mobile.json' ),
			JSON.stringify( {
				schema: 'data-liberation/layout-geometry-capture/v1',
				observations: [ observation( 390, 'mobile' ) ],
				omissions: {},
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		writeFileSync( join( outputDir, 'resources', 'cdn', 'site.css' ), '.desktop{display:block}' );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					'https://cdn.example/site.css': {
						path: 'resources/cdn/site.css',
						contentType: 'text/css',
					},
				},
				failures: [],
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const proof = JSON.parse( readFileSync( join( outputDir, 'layout-geometry-proof.json' ), 'utf8' ) );
		expect( html ).not.toContain( 'data-dla-geometry-id' );
		expect( html ).not.toContain( 'onclick=' );
		expect( html ).not.toContain( '<script' );
		expect( html ).not.toContain( '<iframe' );
		expect( html ).not.toContain( '<base' );
		expect( html ).not.toContain( 'http-equiv="refresh"' );
		expect( html ).not.toContain( 'javascript:' );
		expect( html ).not.toContain( 'action="https://evil.example/' );
		expect( html ).toContain( '<body class="responsive">' );
		expect( html ).toContain(
			'class="data-liberation-desktop-document responsive desktop-body" style="margin:3px;padding:4px"'
		);
		expect( html ).toContain(
			'class="data-liberation-mobile-document responsive mobile-body" style="margin:5px;padding:6px"'
		);
		expect( html ).toContain( 'href="/cdn/site.css"' );
		expect( proof.reductions ).toHaveLength( 2 );
		expect( proof.nodes ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( {
					selector: 'div:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(1)',
					source_hash: createHash( 'sha256' ).update( html ).digest( 'hex' ),
					boxes: [ expect.objectContaining( { viewport: 1440 } ) ],
				} ),
				expect.objectContaining( {
					selector: 'div:nth-of-type(2) > main:nth-of-type(1) > div:nth-of-type(1)',
					boxes: [ expect.objectContaining( { viewport: 390 } ) ],
				} ),
			] )
		);
	} );

	it( 'treats capture correspondence attributes as equivalence, not difference', () => {
		const desktop =
			'<html><body><main><div data-dla-geometry-id="desktop-wrapper-0" class="page" style="width:940px"><h1>Same heading</h1><img src="/a.jpg" alt="a"></div></main></body></html>';
		const mobile =
			'<html><body><main><div data-dla-geometry-id="mobile-wrapper-0" class="page mobile-page" style="width:100%"><h1>Same heading</h1><img src="/a.jpg" alt="a"></div></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer(
				desktop,
				mobile.replace( '<h1>Same heading</h1>', '<h1>Same heading</h1><p>Mobile extra</p>' )
			)
		).toBe( true );
	} );

	it( 'treats changing text as equivalence, not a second document', () => {
		const desktop =
			'<html><body><main><h1>Opening</h1><div><span>17</span><span>HEURES</span><span>52</span><span>SEC</span></div></main></body></html>';
		const mobile =
			'<html><body><main><h1>Opening</h1><div><span>17</span><span>HEURES</span><span>38</span><span>SEC</span></div></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer( desktop, mobile.replace( 'Opening', 'Fermeture' ) )
		).toBe( false );
		expect(
			documentsDiffer(
				desktop,
				mobile.replace( '</div></main>', '</div><aside>Menu</aside></main>' )
			)
		).toBe( true );
	} );

	it( 'treats capture geometry ids and runtime UUIDs as equivalence, not a second document', () => {
		const desktop =
			'<html><body><main><div id="desktop-target-0"><h1>About</h1><section id="AE7E84B0-6F1E-4160-B12C-99F8F4749F09"><p>Hello</p></section></div></main></body></html>';
		const mobile =
			'<html><body><main><div id="mobile-target-0"><h1>About</h1><section id="C0834C17-B49B-4A41-88EB-72DE5F404700"><p>Hello</p></section></div></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer(
				desktop,
				mobile.replace( '</section>', '</section><aside id="mobile-menu">Menu</aside>' )
			)
		).toBe( true );
	} );

	it( 'treats a viewport-injected YUI widget as equivalence, not a second document', () => {
		const desktop =
			'<html><body><div id="siteWrapper"><header><nav><a href="/">Home</a></nav></header><main><h1>About</h1><p>Hello</p></main></div></body></html>';
		const mobile =
			'<html><body><div id="yui_3_17_2_1_1789567315719_163" class="yui3-widget sqs-mobile-info-bar"><div id="yui_3_17_2_1_1789567315719_165"><a href="tel:1">Call</a></div></div><div id="siteWrapper"><header><nav><a href="/">Home</a></nav></header><main><h1>About</h1><p>Hello</p></main></div></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer( desktop, mobile.replace( '<p>Hello</p>', '<p>Hello</p><p>Mobile extra</p>' ) )
		).toBe( true );
	} );

	it( 'treats Squarespace block-yui map chrome as equivalence, not a second document', () => {
		const desktop =
			'<html><body><main><h1>About</h1><div id="block-yui_3_17_2_1_1755739610085_5613"><button type="button"></button><table><tr><td><kbd>←</kbd></td><td>Move left</td></tr></table></div></main></body></html>';
		const mobile =
			'<html><body><main><h1>About</h1><div id="block-yui_3_17_2_1_1755739610085_5613"><button type="button"></button><span>To navigate the map with touch gestures double-tap and hold your finger on the map, then drag the map.</span><table><tr><td><kbd>←</kbd></td><td>Move left</td></tr></table></div></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer(
				desktop,
				mobile.replace( '</main>', '<aside id="mobile-menu">Menu</aside></main>' )
			)
		).toBe( true );
	} );

	it( 'treats generated form field names as equivalence, not a second document', () => {
		const desktop =
			'<html><body><main><h1>Contact</h1><form action="/form"><input id="message-field" name="message-yui_5a971da7-2728-4c20-80a1-6b77a38b830d-field" type="text"></form></main></body></html>';
		const mobile =
			'<html><body><main><h1>Contact</h1><form action="/form"><input id="message-field" name="message-yui_69609980-c587-4cc8-9d6e-c7268aedab8d-field" type="text"></form></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer( desktop, mobile.replace( 'type="text"', 'type="email"' ) )
		).toBe( true );
	} );

	it( 'treats viewport hydration attributes as equivalence, not a second document', () => {
		const desktop =
			'<html><body><div id="siteWrapper"><a href="/cart" tabindex="0" data-test="continue-to-cart" data-current-styles="{&quot;layout&quot;:&quot;desktop&quot;}">Cart</a><header data-controller="Header"><nav><a href="/">Home</a></nav></header><main><h1>About</h1></main></div></body></html>';
		const mobile =
			'<html><body><div id="siteWrapper"><a href="/cart" data-test="continue-to-cart" data-current-styles="{&quot;layout&quot;:&quot;mobile&quot;}">Cart</a><header data-controller="Header"><nav><a href="/">Home</a></nav></header><main><h1>About</h1></main></div></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer( desktop, mobile.replace( 'href="/"', 'href="/menu"' ) )
		).toBe( true );
	} );

	it( 'treats viewport-only iframe embeds as equivalence, not a second document', () => {
		const desktop =
			'<html><body><main><h1>Contact</h1><form action="/form"><input name="email"></form>' +
			'<iframe name="form-1-target-1789528387446" id="form-1-target-1789528387446" style="display:none"></iframe>' +
			'<iframe src="//www.weebly.com/weebly/apps/generateMap.php?map=google"></iframe>' +
			'</main></body></html>';
		const mobile =
			'<html><body><main><h1>Contact</h1><form action="/form"><input name="email"></form></main></body></html>';
		expect( documentsDiffer( desktop, mobile ) ).toBe( false );
		expect(
			documentsDiffer(
				desktop,
				mobile.replace( '</form>', '</form><aside id="mobile-only">Menu</aside>' )
			)
		).toBe( true );
	} );

	it( 'collapses a contact page whose only mobile gap is embed iframes, keeping the desktop map', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-collapse-iframe-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main><h1>Contact</h1><form action="/form"><input name="email"></form>' +
				'<iframe class="map" src="https://source.example/wrong" data-dla-visual-iframe-src="https://maps.example/embed" data-dla-visual-iframe-width="1280" data-dla-visual-iframe-height="350"></iframe>' +
				'</main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><main><h1>Contact</h1><form action="/form"><input name="email"></form></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'weebly',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect( $( '.data-liberation-desktop-document' ) ).toHaveLength( 0 );
		expect( $( '.data-liberation-mobile-document' ) ).toHaveLength( 0 );
		expect( $( 'form' ) ).toHaveLength( 1 );
		expect( $( 'iframe' ).attr( 'src' ) ).toBe( 'https://maps.example/embed' );
		const receipt = JSON.parse(
			readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' )
		);
		expect( receipt.routes[ 0 ].responsiveVariants ).toMatchObject( {
			variants: 1,
			outcome: 'collapsed-equivalent',
		} );
	} );

	it( 'collapses before viewport peeling so hidden-chrome snapshots stay one document', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-collapse-before-peel-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const inner =
			'<header><nav><a href="/">Home</a></nav></header><main><h1>About</h1><p>Hello</p></main>';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body>${ inner }</body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<html><body><div id="yui_3_17_2_1_1" class="yui3-widget sqs-mobile-info-bar" style="position:fixed;bottom:0"><a href="tel:1">Call</a></div>${ inner }</body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'squarespace',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html ).not.toContain( 'data-liberation-mobile-document' );
		const receipt = JSON.parse( readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' ) );
		expect( receipt.routes[ 0 ].responsiveVariants ).toMatchObject( {
			variants: 1,
			outcome: 'collapsed-equivalent',
		} );
	} );

	it( 'collapses structurally equivalent responsive variants into one document and records why', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-collapse-equivalent-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const sharedStyles = '<style>.wrap{margin:0 auto}.wrap img{max-width:100%}</style>';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${ sharedStyles }</head><body class="page"><main><div data-dla-geometry-id="desktop-wrapper-0" style="width:940px"><h1>About</h1><img src="/media/a.jpg" alt="a"></div></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<html><head><meta name="viewport" content="width=device-width, initial-scale=1">${ sharedStyles }</head><body class="page mobile"><main><div data-dla-geometry-id="mobile-wrapper-0" style="width:100%"><h1>About</h1><img src="/media/a.jpg" alt="a"></div></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'weebly',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect( $( '.data-liberation-desktop-document' ) ).toHaveLength( 0 );
		expect( $( '.data-liberation-mobile-document' ) ).toHaveLength( 0 );
		expect( $( 'h1' ) ).toHaveLength( 1 );
		expect( $( 'img' ) ).toHaveLength( 1 );
		// The source's own stylesheet keeps applying at every width.
		expect( html ).toContain( '.wrap{margin:0 auto}.wrap img{max-width:100%}' );
		const receipt = JSON.parse(
			readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' )
		);
		expect( receipt.routes[ 0 ].responsiveVariants ).toEqual( {
			variants: 1,
			outcome: 'collapsed-equivalent',
			reason:
				'mobile document is structurally equivalent to desktop once capture-infrastructure attributes are normalized; shipped one document',
			css: 'shared',
		} );
	} );

	it( 'collapses equivalent variants while preserving viewport-specific styles as CSS', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-collapse-scoped-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><style>.hero{color:red}</style></head><body><main><div data-dla-geometry-id="desktop-wrapper-0"><h1>About</h1></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><head><style>.hero{color:blue}</style></head><body><main><div data-dla-geometry-id="mobile-wrapper-0"><h1>About</h1></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'weebly',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect( $( '.data-liberation-desktop-document' ) ).toHaveLength( 0 );
		expect( $( '.data-liberation-mobile-document' ) ).toHaveLength( 0 );
		expect( $( 'h1' ) ).toHaveLength( 1 );
		// Each breakpoint keeps its own stylesheet through media scoping.
		expect( html ).toContain( 'media="(min-width:769px)"' );
		expect( html ).toContain( 'media="(max-width:768px)"' );
		const styles = [ ...html.matchAll( /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi ) ];
		expect( styles.some( ( s ) => s[ 1 ].includes( 'min-width' ) && s[ 2 ].includes( 'color:red' ) ) ).toBe(
			true
		);
		expect( styles.some( ( s ) => s[ 1 ].includes( 'max-width' ) && s[ 2 ].includes( 'color:blue' ) ) ).toBe(
			true
		);
		const receipt = JSON.parse(
			readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' )
		);
		expect( receipt.routes[ 0 ].responsiveVariants ).toMatchObject( {
			variants: 1,
			outcome: 'collapsed-equivalent',
			css: 'viewport-scoped',
		} );
	} );

	it( 'ships both variants when the mobile document genuinely differs, and says so', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-collapse-structural-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main><div data-dla-geometry-id="desktop-wrapper-0"><h1>About</h1><section id="gallery"><img src="/media/a.jpg" alt="a"></section></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><main><div data-dla-geometry-id="mobile-wrapper-0"><h1>About</h1><section id="gallery"><img src="/media/a.jpg" alt="a"></section><aside id="mobile-menu">Mobile only</aside></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'weebly',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect( $( '.data-liberation-desktop-document' ) ).toHaveLength( 1 );
		expect( $( '.data-liberation-mobile-document' ) ).toHaveLength( 1 );
		expect( $( '#mobile-menu' ) ).toHaveLength( 1 );
		const receipt = JSON.parse(
			readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' )
		);
		expect( receipt.routes[ 0 ].responsiveVariants ).toEqual( {
			variants: 2,
			outcome: 'dual-structural',
			reason: 'mobile document differs structurally from desktop; both variants shipped',
		} );
	} );

	it( 'preserves only capture-attested bounded HTTPS iframe surfaces', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-visual-iframe-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main>' +
				'<iframe class="map" title="Map" src="https://source.example/wrong" width="100%" height="100%" allow="fullscreen" loading="lazy" sandbox="allow-scripts" referrerpolicy="no-referrer" allowfullscreen frameborder="0" onclick="steal()" srcdoc="<script>steal()</script>" data-dla-visual-iframe-src="https://maps.example/embed" data-dla-visual-iframe-width="1280" data-dla-visual-iframe-height="350"></iframe>' +
				'<iframe src="https://hidden.example/embed" width="500" height="300"></iframe>' +
				'<iframe src="javascript:steal()" data-dla-visual-iframe-src="javascript:steal()" data-dla-visual-iframe-width="500" data-dla-visual-iframe-height="300"></iframe>' +
				'<iframe src="https://zero.example/embed" data-dla-visual-iframe-src="https://zero.example/embed" data-dla-visual-iframe-width="0" data-dla-visual-iframe-height="300"></iframe>' +
			'</main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( $( 'iframe' ) ).toHaveLength( 1 );
		expect( $( 'iframe' ).attr( 'src' ) ).toBe( 'https://maps.example/embed' );
		expect( $( 'iframe' ).attr( 'width' ) ).toBe( '1280' );
		expect( $( 'iframe' ).attr( 'height' ) ).toBe( '350' );
		expect( $( 'iframe' ).attr( 'class' ) ).toBe( 'map' );
		expect( $( 'iframe' ).attr( 'frameborder' ) ).toBeUndefined();
		expect( $( 'iframe' ).attr( 'onclick' ) ).toBeUndefined();
		expect( $( 'iframe' ).attr( 'srcdoc' ) ).toBeUndefined();
		expect( $.html() ).not.toContain( 'data-dla-visual-iframe-' );
	} );

	it( 'rejects unsafe shared-style media attributes', () => {
		expect( portableInlineStyle( ' media="screen & <style"', '.unsafe{}' ) ).toBeUndefined();
		expect( portableInlineStyle( ' media="screen and (min-width: 1px)"', '.safe{}' ) ).toEqual( {
			key: 'screen and (min-width: 1px)\n.safe{}',
			media: 'screen and (min-width: 1px)',
		} );
	} );

	it( 'preserves validated HubSpot form descriptors across raced desktop and mobile captures', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-form-embed-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const descriptor =
			'class="hs-form-frame contact-form" data-portal-id="145288931" data-form-id="D320B12E-97D4-4FC0-91BE-27D99192F4E9" data-region="EU1"';
		const adversarial =
			'<div class="hs-form-frame" data-portal-id="145288931"><iframe src="https://js-eu1.hsforms.net/forms/embed/v2/?portalId=145288931"></iframe></div><iframe src="https://evil.example/form" srcdoc="<script>steal()</script>"></iframe><object data="https://evil.example/payload"></object><embed src="data:text/html,evil"><base href="https://evil.example/"><a href="java\nscript:steal()">unsafe</a><noscript>fallback</noscript>';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body><main><div ${ descriptor }><iframe src="https://js-eu1.hsforms.net/forms/embed/v2/?portalId=145288931&amp;formId=d320b12e-97d4-4fc0-91be-27d99192f4e9&amp;region=eu1" onload="steal()" srcdoc="<script>steal()</script>"></iframe></div>${ adversarial }<script src="https://js-eu1.hsforms.net/forms/embed/v2.js"></script></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<html><body><main><div ${ descriptor }></div>${ adversarial }<script src="https://js-eu1.hsforms.net/forms/embed/v2.js"></script></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect(
			$( '.hs-form-frame[data-portal-id="145288931"][data-form-id][data-region="EU1"]' )
		).toHaveLength( 1 );
		expect( $( '.hs-form-frame iframe' ).attr( 'src' ) ).toBe(
			'https://js-eu1.hsforms.net/forms/embed/v2/?portalId=145288931&formId=d320b12e-97d4-4fc0-91be-27d99192f4e9&region=eu1'
		);
		expect( $( 'iframe' ) ).toHaveLength( 1 );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html ).not.toMatch( /<(?:script|noscript|object|embed|base)\b/i );
		expect( html ).not.toMatch( /\s(?:onload|srcdoc)=/i );
		expect( html ).not.toContain( 'javascript:' );
		expect( html ).not.toContain( 'evil.example' );
	} );

	it( 'bounds declarative form synthesis deterministically on desktop and mobile', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-bounded-form-embed-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const forms = Array.from(
			{ length: 40 },
			( _, index ) =>
				`<div class="hs-form-frame" data-portal-id="${
					index + 1
				}" data-form-id="d320b12e-97d4-4fc0-91be-27d99192f4e9" data-region="eu1"></div>`
		).join( '' );
		for ( const path of [ 'html/homepage.html', 'html-mobile/homepage.html' ] )
			writeFileSync( join( outputDir, path ), `<html><body>${ forms }</body></html>` );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( $( '.hs-form-frame' ) ).toHaveLength( 40 );
		expect( $( '.hs-form-frame iframe' ) ).toHaveLength( 32 );
		expect( $( '.hs-form-frame' ).eq( 31 ).find( 'iframe' ).attr( 'src' ) ).toContain(
			'portalId=32'
		);
		expect( $( '.hs-form-frame' ).eq( 32 ).find( 'iframe' ) ).toHaveLength( 0 );
	} );

	it( 'removes a multiline media srcset URL containing an apostrophe without leaving a malformed reference', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-quoted-media-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const imageUrl = "https://static.wixstatic.com/media/Happy%20Women's%20Day.jpg";
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body><img srcset="${ imageUrl } 1x,\n${ imageUrl } 2x"></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markFailure( imageUrl, 'HTTP 404' );
		media.flush();
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const $ = cheerio.load( html );
		expect( $( 'img' ).attr( 'srcset' ) ).toBeUndefined();
		expect( html ).not.toContain( "Women's%20Day.jpg" );
		expect( html ).not.toContain( "R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='s%20Day.jpg" );
	} );

	it( 'localizes a same-origin srcset whose candidate URLs contain commas', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-comma-srcset-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		// An image-service path carries its transform in the URL, commas and all.
		const variant = ( width: number, height: number ) =>
			`/media/asset~mv2.png/v1/fill/w_${ width },h_${ height },al_c,q_85,enc_avif,quality_auto/file.png`;
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body><img src="${ variant( 58, 57 ) }" srcset="${ variant( 58, 57 ) } 1x, ${ variant(
				116,
				114
			) } 2x"></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		writeFileSync( join( outputDir, 'media', 'asset.png' ), 'asset' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess(
			'https://example.com/media/asset~mv2.png',
			join( outputDir, 'media', 'asset.png' )
		);
		media.flush();
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( cheerio.load( html )( 'img' ).attr( 'srcset' ) ).toBe(
			'/media/asset.png 1x, /media/asset.png 2x'
		);
		expect( html ).not.toContain( '/v1/fill/' );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
	} );

	it( 'localizes deduplicated captured width renditions before returning early', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-lazy-image-resource-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'resources/media', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const bare = 'https://example.com/media/plant.webp';
		const firstRendition = `${ bare }?format=300w`;
		const secondRendition = `${ bare }?format=600w`;
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<img data-src="${ bare }" src="${ firstRendition }"><img data-src="${ bare }" src="${ secondRendition }">`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		writeFileSync( join( outputDir, 'resources', 'media', 'plant-300.webp' ), 'plant' );
		writeFileSync( join( outputDir, 'resources', 'media', 'plant-600.webp' ), 'plant' );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					[ firstRendition ]: {
						path: 'resources/media/plant-300.webp',
						contentType: 'image/webp',
					},
					[ secondRendition ]: {
						path: 'resources/media/plant-600.webp',
						contentType: 'image/webp',
					},
				},
				failures: [],
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( $( 'img' ).eq( 0 ).attr( 'src' ) ).toBe( '/media/plant-300.webp' );
		expect( $( 'img' ).eq( 1 ).attr( 'src' ) ).toBe( '/media/plant-300.webp' );
		expect( readFileSync( join( outputDir, 'website', 'media', 'plant-300.webp' ), 'utf8' ) ).toBe( 'plant' );
	} );

	it( 'writes one successful asset outcome with every captured route reference', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'media', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrl = 'https://cdn.example/shared.png';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<img src="${ imageUrl }"><img src="${ imageUrl }">`
		);
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<img src="${ imageUrl }">` );
		writeFileSync( join( outputDir, 'media', 'shared.png' ), 'shared' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( imageUrl, join( outputDir, 'media', 'shared.png' ) );
		media.flush();

		exportWebsiteCapture( {
			outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [],
		} );

		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence ).toMatchObject( { schema: ASSET_EVIDENCE_SCHEMA } );
		expect( evidence ).toMatchObject( {
			assetCount: 1,
			assetsTruncated: false,
			referenceLimit: 100,
		} );
		expect( evidence.assets ).toEqual( [ {
			id: imageUrl,
			sourceUrl: imageUrl,
			outcome: 'successful',
			retrieval: 'retrieved',
			portable: 'included',
			path: 'website/media/shared.png',
			portableAssetId: 'website/media/shared.png',
			referenceCount: 2,
			referencesTruncated: false,
			references: [
				{ route: 'https://example.com/', path: 'website/index.html', document: 'desktop', reference: imageUrl },
				{ route: 'https://example.com/about', path: 'website/about/index.html', document: 'desktop', reference: imageUrl },
			],
		} ] );
	} );

	it( 'writes failed asset outcomes with every captured route reference', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-failed-asset-evidence-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrl = 'https://cdn.example/missing.png';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), `<img src="${ imageUrl }">` );
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<img src="${ imageUrl }">` );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);
		MediaStubStore.load( outputDir ).markFailure( imageUrl, 'HTTP 404' );

		exportWebsiteCapture( {
			outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [],
		} );

		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence.assets ).toEqual( [ {
			id: imageUrl,
			sourceUrl: imageUrl,
			outcome: 'failed',
			retrieval: 'failed',
			portable: 'not-included',
			error: 'HTTP 404',
			referenceCount: 2,
			referencesTruncated: false,
			references: [
				{ route: 'https://example.com/', path: 'website/index.html', document: 'desktop', reference: imageUrl },
				{ route: 'https://example.com/about', path: 'website/about/index.html', document: 'desktop', reference: imageUrl },
			],
		} ] );
	} );

	it( 'traces retained mobile documents and reachable CSS dependencies back to each route', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-css-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'resources/css', 'resources/media', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const cssUrl = 'https://example.com/css/site.css';
		const imageUrl = 'https://example.com/media/background.png';
		const mobileUrl = 'https://cdn.example/mobile-only.png';
		const missingFont = 'https://example.com/fonts/missing.woff2';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body><link rel="stylesheet" href="${ cssUrl }"></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			`<html><body><link rel="stylesheet" href="${ cssUrl }"></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<html><body><aside id="mobile-menu">Menu</aside><img src="${ mobileUrl }"></body></html>`
		);
		writeFileSync( join( outputDir, 'resources/css/site.css' ), `body{background:url("${ imageUrl }")}@font-face{src:url("${ missingFont }")}` );
		writeFileSync( join( outputDir, 'resources/media/background.png' ), 'image' );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( { version: 1, entries: {
			'https://example.com/': { html: 'html/homepage.html' },
			'https://example.com/about': { html: 'html/about.html' },
		} } ) );
		writeFileSync( join( outputDir, 'resources/manifest.json' ), JSON.stringify( { version: 1, resources: {
			[ cssUrl ]: { path: 'resources/css/site.css', contentType: 'text/css' },
			[ imageUrl ]: { path: 'resources/media/background.png', contentType: 'image/png' },
		}, failures: [ { url: missingFont, error: 'HTTP 404' } ] } ) );
		const media = MediaStubStore.load( outputDir );
		writeFileSync( join( outputDir, 'mobile.png' ), 'mobile' );
		media.markSuccess( mobileUrl, join( outputDir, 'mobile.png' ) );
		media.flush();

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence.coverage ).toMatchObject( { documentCount: 3, cssTraversal: 'reachable captured CSS resources only' } );
		expect( evidence.assets.find( ( asset: { sourceUrl: string } ) => asset.sourceUrl === mobileUrl ) ).toMatchObject( {
			outcome: 'successful', references: [ expect.objectContaining( { document: 'mobile' } ) ],
		} );
		for ( const sourceUrl of [ imageUrl, missingFont ] ) {
			const asset = evidence.assets.find( ( candidate: { sourceUrl: string } ) => candidate.sourceUrl === sourceUrl );
			expect( asset.references ).toHaveLength( 2 );
			expect( asset.references.every( ( reference: { document: string } ) => reference.document === 'css' ) ).toBe( true );
		}
		expect( evidence.assets.find( ( asset: { sourceUrl: string } ) => asset.sourceUrl === missingFont ) ).toMatchObject( {
			outcome: 'failed', retrieval: 'failed', portable: 'not-included',
		} );
	} );

	it( 'groups two deduplicated source URLs by one portable asset ID', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-dedup-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'media', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const first = 'https://cdn.example/one.png';
		const second = 'https://cdn.example/two.png';
		writeFileSync( join( outputDir, 'html/homepage.html' ), `<img src="${ first }"><img src="${ second }">` );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } ) );
		writeFileSync( join( outputDir, 'media/one.png' ), 'same bytes' );
		writeFileSync( join( outputDir, 'media/two.png' ), 'same bytes' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( first, join( outputDir, 'media/one.png' ) );
		media.markSuccess( second, join( outputDir, 'media/two.png' ) );
		media.flush();

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const assets = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) ).assets;
		const firstAsset = assets.find( ( asset: { sourceUrl: string } ) => asset.sourceUrl === first );
		const secondAsset = assets.find( ( asset: { sourceUrl: string } ) => asset.sourceUrl === second );
		expect( firstAsset.portableAssetId ).toBe( secondAsset.portableAssetId );
		expect( assets.filter( ( asset: { portableAssetId?: string } ) => asset.portableAssetId === firstAsset.portableAssetId )
			.map( ( asset: { sourceUrl: string } ) => asset.sourceUrl ) ).toEqual( [ first, second ] );
	} );

	it( 'serializes many deduplicated source URLs without repeated alias arrays', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-linear-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'media', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const sourceUrls = Array.from( { length: 200 }, ( _, index ) => `https://cdn.example/shared/${ index }.png` );
		writeFileSync( join( outputDir, 'html/homepage.html' ), sourceUrls.map( ( url ) => `<img src="${ url }">` ).join( '' ) );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( { version: 1, entries: {
			'https://example.com/': { html: 'html/homepage.html' },
		} } ) );
		const media = MediaStubStore.load( outputDir );
		for ( const [ index, sourceUrl ] of sourceUrls.entries() ) {
			const path = join( outputDir, 'media', `${ index }.png` );
			writeFileSync( path, 'same bytes' );
			media.markSuccess( sourceUrl, path );
		}
		media.flush();

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const serialized = readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' );
		const evidence = JSON.parse( serialized );
		expect( evidence.assets ).toHaveLength( sourceUrls.length );
		expect( new Set( evidence.assets.map( ( asset: { portableAssetId: string } ) => asset.portableAssetId ) ) ).toHaveLength( 1 );
		expect( serialized ).not.toContain( 'portableAliases' );
		expect( serialized.length ).toBeLessThan( 150_000 );
	} );

	it( 'does not call a stale successful cache entry a successful portable transfer', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-stale-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrl = 'https://cdn.example/missing-local.png';
		writeFileSync( join( outputDir, 'html/homepage.html' ), `<img src="${ imageUrl }">` );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( { version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } } } ) );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( imageUrl, join( outputDir, 'gone.png' ) );
		media.flush();

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const asset = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) ).assets[ 0 ];
		expect( asset ).toMatchObject( { outcome: 'failed', retrieval: 'unknown', portable: 'not-included' } );
	} );

	it( 'counts every retained reference while bounding emitted reference locations', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-bounds-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'media', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrl = 'https://cdn.example/shared.png';
		const entries: Record< string, { html: string } > = {};
		for ( let index = 0; index < 101; index++ ) {
			const name = `${ index }.html`;
			writeFileSync( join( outputDir, 'html', name ), `<img src="${ imageUrl }">` );
			entries[ `https://example.com/${ index }` ] = { html: `html/${ name}` };
		}
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( { version: 1, entries } ) );
		writeFileSync( join( outputDir, 'media/shared.png' ), 'shared' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( imageUrl, join( outputDir, 'media/shared.png' ) );
		media.flush();

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/0', platform: 'generic', summary: {}, failures: [] } );

		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence ).toMatchObject( { assetCount: 1, totalReferenceCount: 101, referenceLimit: 100 } );
		expect( evidence.assets[ 0 ] ).toMatchObject( { referenceCount: 101, referencesTruncated: true } );
		expect( evidence.assets[ 0 ].references ).toHaveLength( 100 );
	} );

	it( 'bounds retained asset evidence while reporting a non-exact asset lower bound', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-asset-evidence-asset-bounds-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrls = Array.from(
			{ length: 10_001 },
			( _, index ) => `https://cdn.example/${ String( index ).padStart( 5, '0' ) }.png`
		);
		writeFileSync( join( outputDir, 'html/homepage.html' ), imageUrls.map( ( url ) => `<img src="${ url }">` ).join( '' ) );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( {
			version: 1,
			entries: { 'https://example.com/': { html: 'html/homepage.html' } },
		} ) );

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence ).toMatchObject( {
			assetCount: 10_001,
			assetCountExact: false,
			totalReferenceCount: 10_001,
			assetsTruncated: true,
			coverage: {
				assetLimit: 10_000,
				assetSelection: 'first reachable source URLs in retained route traversal',
			},
		} );
		expect( evidence.assets ).toHaveLength( 10_000 );
		expect( evidence.assets.map( ( asset: { sourceUrl: string } ) => asset.sourceUrl ) ).toEqual( imageUrls.slice( 0, 10_000 ) );
	}, 120_000 );

	it( 'exports captured routes and localized media as a website directory', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><style>.desktop{color:blue}</style></head><body><button id="contact" aria-haspopup="dialog">Contact</button><a href="https://example.com/shop/about?from=home#team">About</a><a href="https://example.com/shop/missing">Missing</a><a href="https://external.example/about">External</a><img src="https://cdn.example/logo.png"><img src="https://cdn.example/logo-copy.png"><img src="https://cdn.example/avatar.png&amp;quot;"><img src="/hero.png?w=128" srcset="/hero.png?w=128 128w, /hero.png?w=4096 4096w"><picture><source media="(min-width: 751px)" srcset="https://cdn.example/responsive.png?w=1200"><img src="https://cdn.example/responsive.png?w=320"></picture><img src="https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_1034,h_1349,al_b,q_90/hash~mv2.jpg" srcset="https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_567,h_740,al_b,q_90,enc_avif,quality_auto/hash~mv2.jpg 1x, https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_1034,h_1349,al_b,q_90,enc_avif,quality_auto/hash~mv2.jpg 2x"><h1>Home</h1><p>$100.00</p><noscript><main>This site requires JavaScript</main></noscript></body></html>'
		);
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><head><style>.mobile{color:red}body:not(.device-mobile-optimized) .desktop-only{display:flex}</style></head><body class="device-mobile-optimized"><main class="mobile"><h1>Mobile Home</h1><p>Mobile only</p><p>$100.00</p></main></body></html>'
		);
		writeFileSync( join( outputDir, 'media', 'logo.png' ), 'png' );
		writeFileSync( join( outputDir, 'media', 'avatar.pngquot' ), 'avatar' );
		writeFileSync( join( outputDir, 'media', 'hero.png' ), 'base' );
		writeFileSync( join( outputDir, 'media', 'hero-2.png' ), '128' );
		writeFileSync( join( outputDir, 'media', 'hero-3.png' ), Buffer.alloc( 6 * 1024 * 1024 ) );
		writeFileSync( join( outputDir, 'media', 'responsive.png' ), Buffer.alloc( 6 * 1024 * 1024 ) );
		writeFileSync( join( outputDir, 'media', 'responsive-mobile.png' ), 'responsive-mobile' );
		writeFileSync( join( outputDir, 'media', 'wix.jpg' ), 'wix' );
		writeFileSync( join( outputDir, 'media', 'localized.jpg' ), 'localized' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/shop/': {
						html: 'html/homepage.html',
						interactions: {
							schema: 'data-liberation/interaction-states/v2',
							sourceUrl: 'https://example.com/shop/',
							viewport: { width: 1440, height: 900 },
							capturedAt: '2026-08-22T00:00:00.000Z',
							states: [
								{
									status: 'captured',
									trigger: {
										selector: '#contact',
										tag: 'button',
										id: 'contact',
										ariaHaspopup: 'dialog',
										dataBindings: { 'data-modalid': 'contact' },
									},
									dialog: {
										selector: '#contact-dialog',
										tag: 'div',
										id: 'contact-dialog',
										role: 'dialog',
										ariaModal: true,
										html: '<div id="contact-dialog" role="dialog"><nav><a href="https://example.com/shop/about?from=menu#team">About</a><a href="https://external.example/contact">External</a></nav><form><input name="email"></form></div>',
										htmlBytes: 193,
										htmlTruncated: false,
									},
								},
							],
							initialDialogs: [
								{
									status: 'captured',
									initiallyVisible: true,
									dialog: {
										selector: '#automatic-dialog',
										tag: 'div',
										id: 'automatic-dialog',
										role: 'dialog',
										ariaModal: true,
										ariaLabel: 'Automatic popup',
										html: '<div id="automatic-dialog" role="dialog"><p>Automatic popup</p><button id="automatic-close" aria-label="Close automatic popup">Close</button></div>',
										htmlBytes: 150,
										htmlTruncated: false,
									},
									dismissal: {
										control: { selector: '#automatic-close', tag: 'button', label: 'Close automatic popup' },
										verified: true,
									},
								},
							],
						},
					},
					'https://example.com/shop/about': { html: 'html/about.html' },
					'https://example.com/': { html: 'html/corporate.html' },
				},
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/logo.png', join( outputDir, 'media', 'logo.png' ) );
		media.markSuccess(
			'https://cdn.example/logo-copy.png',
			join( outputDir, 'media', 'logo.png' )
		);
		media.markSuccess(
			'https://cdn.example/avatar.png&quot;',
			join( outputDir, 'media', 'avatar.pngquot' )
		);
		media.markSuccess( 'https://example.com/hero.png', join( outputDir, 'media', 'hero.png' ) );
		media.markSuccess(
			'https://example.com/hero.png?w=128',
			join( outputDir, 'media', 'hero-2.png' )
		);
		media.markSuccess(
			'https://example.com/hero.png?w=4096',
			join( outputDir, 'media', 'hero-3.png' )
		);
		media.markSuccess(
			'https://example.com/only-huge.png',
			join( outputDir, 'media', 'hero-3.png' )
		);
		media.markSuccess(
			'https://cdn.example/responsive.png?w=1200',
			join( outputDir, 'media', 'responsive.png' )
		);
		media.markSuccess(
			'https://cdn.example/responsive.png?w=320',
			join( outputDir, 'media', 'responsive-mobile.png' )
		);
		media.markSuccess(
			'https://static.wixstatic.com/media/hash~mv2.jpg',
			join( outputDir, 'media', 'wix.jpg' )
		);
		media.markSuccess(
			'https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_704,h_853/rendered.jpg',
			join( outputDir, 'media', 'localized.jpg' )
		);
		media.markFailure( 'https://example.com/missing.png?w=1280', 'HTTP 404' );
		media.markFailure(
			'https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_554,h_597/rendered.jpg',
			'HTTP 404'
		);
		media.flush();
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`${ readFileSync(
				join( outputDir, 'html', 'homepage.html' ),
				'utf8'
			) }<img src="/only-huge.png"><img src="https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_554,h_597/rendered.jpg"><script src="/uncaptured.js"></script   ><img src="images/blank.png"><div style="background-image:url(images/blank.png)"></div><div style="background-image:image-set(url('/missing.png?w=1280') 1x)"></div>`
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/shop/',
			platform: 'fake',
			title: 'Example',
			summary: { pagesExtracted: 2 },
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect(
			JSON.parse( readFileSync( join( outputDir, 'layout-geometry-report.json' ), 'utf8' ) )
		).toMatchObject( {
			schema: 'data-liberation/layout-geometry-proof/v1',
			capture_omissions: { capture_missing: 4 },
		} );
		expect( receipt ).toMatchObject( {
			schema: CAPTURE_RECEIPT_SCHEMA,
			websiteRoot: 'website',
			entrypoint: 'website/index.html',
			title: 'Example',
			routes: [
				{ url: 'https://example.com/shop/', path: 'website/index.html' },
				{ url: 'https://example.com/shop/about', path: 'website/about/index.html' },
			],
			assets: [
				{ sourceUrl: 'https://cdn.example/logo.png', path: 'website/media/logo.png' },
				{
					sourceUrl: 'https://cdn.example/avatar.png&quot;',
					path: 'website/media/avatar.png',
				},
				{ sourceUrl: 'https://example.com/hero.png?w=128', path: 'website/media/hero-2.png' },
				{
					sourceUrl: 'https://cdn.example/responsive.png?w=1200',
					path: 'website/media/responsive.png',
				},
				{
					sourceUrl: 'https://cdn.example/responsive.png?w=320',
					path: 'website/media/responsive-mobile.png',
				},
				{
					sourceUrl: 'https://static.wixstatic.com/media/hash~mv2.jpg',
					path: 'website/media/wix.jpg',
				},
				{
					sourceUrl:
						'https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_704,h_853/rendered.jpg',
					path: 'website/media/localized.jpg',
				},
			],
			excludedRoutes: [],
		} );
		expect( receipt.interactions ).toEqual( {
			candidate_count: 1,
			captured_count: 1,
			no_dialog_count: 0,
			click_failed_count: 0,
			truncated_count: 0,
			initial_dialog_count: 1,
			initial_captured_count: 1,
			initial_dismissal_verified_count: 1,
		} );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'/media/logo.png'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'/media/hero-2.png'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'srcset="/media/responsive.png"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'src="/media/responsive-mobile.png"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'/media/hero.png?w=128'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'srcset="/media/wix.jpg 1x, /media/wix.jpg 2x"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'style="object-position:center bottom"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'/media/localized.jpg'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'This site requires JavaScript'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'uncaptured.js'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'images/blank.png'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'class="data-liberation-desktop-document"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'class="data-liberation-mobile-document device-mobile-optimized"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'Mobile Home'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'@media(max-width:768px)'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			':where(.data-liberation-mobile-document) .mobile{color:red}'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			':where(.data-liberation-mobile-document):not(.device-mobile-optimized) .desktop-only{display:flex}'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'<style media="(min-width:769px)">.desktop{color:blue}</style>'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'<p>$100.00</p>'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'<details class="dla-disclosure dla-initial-dialog" open="">'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/about/index.html?from=home#team"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="https://example.com/shop/missing"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="https://external.example/about"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/about/index.html?from=menu#team"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="https://external.example/contact"'
		);
		const browser = await chromium.launch( { headless: true } );
		try {
			const page = await browser.newPage();
			await page.setContent( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
			const menu = page.locator( 'details.dla-disclosure:not(.dla-initial-dialog)' ).first();
			await menu.locator( 'summary' ).evaluate( ( summary ) => ( summary as HTMLElement ).click() );
			expect( await menu.evaluate( ( details ) => ( details as HTMLDetailsElement ).open ) ).toBe( true );
			const menuLinks = menu.locator( '[role="dialog"] a' );
			expect( await menuLinks.first().getAttribute( 'href' ) ).toBe(
				'/about/index.html?from=menu#team'
			);
			expect( await menuLinks.nth( 1 ).getAttribute( 'href' ) ).toBe(
				'https://external.example/contact'
			);
		} finally {
			await browser.close();
		}
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'data:image/gif;base64,'
		);
		expect( readFileSync( join( outputDir, 'website', 'about', 'index.html' ), 'utf8' ) ).toContain(
			'About'
		);
		expect( readFileSync( join( outputDir, 'website', 'media', 'logo.png' ), 'utf8' ) ).toBe(
			'png'
		);
		const interactionReport = JSON.parse(
			readFileSync( join( outputDir, 'interaction-states.json' ), 'utf8' )
		);
		expect( interactionReport ).toMatchObject( {
			schema: CAPTURED_INTERACTIONS_SCHEMA,
			totals: {
				candidate_count: 1,
				captured_count: 1,
				initial_dialog_count: 1,
				initial_dismissal_verified_count: 1,
			},
		} );
		expect( existsSync( join( outputDir, 'artifact.json' ) ) ).toBe( false );
		expect( existsSync( join( outputDir, 'diagnostics.json' ) ) ).toBe( true );
		expect(
			JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedMedia
		).toContainEqual( {
			url: 'https://example.com/missing.png?w=1280',
			error: 'HTTP 404',
		} );
		expect(
			JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedMedia
		).toContainEqual( {
			url: 'https://example.com/only-huge.png',
			error: 'removed because media exceeds portable size or dimension limits',
		} );
	} );

	it( 'exports many large responsive routes within a constrained heap', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-large-capture-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const routeCount = 16;
		const content = 'x'.repeat( 256 * 1024 );
		const entries: Record< string, { html: string } > = {};
		for ( let index = 0; index < routeCount; index++ ) {
			const name = index === 0 ? 'homepage' : `page-${ index }`;
			const route = index === 0 ? 'https://example.com/' : `https://example.com/page-${ index }`;
			const next = index + 1 < routeCount ? `<a href="/page-${ index + 1 }">Next</a>` : '';
			writeFileSync(
				join( outputDir, 'html', `${ name }.html` ),
				`<main><h1>Desktop ${ index }</h1>${ next }<p>${ content }</p></main>`
			);
			writeFileSync(
				join( outputDir, 'html-mobile', `${ name }.html` ),
				`<main><h1>Mobile ${ index }</h1>${ next }<p>${ content }</p></main>`
			);
			entries[ route ] = { html: `html/${ name }.html` };
		}
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries } )
		);

		const runnerPath = join( outputDir, 'export-under-limit.ts' );
		writeFileSync(
			runnerPath,
			`import { existsSync, readFileSync } from 'node:fs';
import { exportWebsiteCapture } from ${ JSON.stringify(
				new URL( './capture-export.ts', import.meta.url ).href
			) };
const outputDir = ${ JSON.stringify( outputDir ) };
const receiptPath = exportWebsiteCapture( {
	outputDir,
	sourceUrl: 'https://example.com/',
	platform: 'fake',
	summary: {},
	failures: [],
} );
const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
if ( receipt.routes.length !== ${ routeCount } ) throw new Error( 'route count mismatch' );
if ( !existsSync( ${ JSON.stringify( join( outputDir, 'website', 'index.html' ) ) } ) )
	throw new Error( 'website was not completed' );
if ( existsSync( ${ JSON.stringify( join( outputDir, '.capture-export-html' ) ) } ) )
	throw new Error( 'staging was not removed' );
`
		);
		const result = spawnSync(
			process.execPath,
			[ '--max-old-space-size=128', '--import', 'tsx', runnerPath ],
			{ cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 }
		);

		expect( result.error ).toBeUndefined();
		expect( result.status, result.stderr ).toBe( 0 );
	}, 70_000 );

	it( 'indexes structured semantic evidence into two bounded shards', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-compact-semantic-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<main><h1>Home</h1></main>' );
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<main><h1>About</h1></main>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' },
					'https://example.com/about': { slug: 'about', html: 'html/about.html' },
				},
			} )
		);
		const spec = {
			selector: 'main > section',
			headings: [ 'Caminos y sabores 🍜' ],
			layout: { samples: Array.from( { length: 600_000 }, () => 'evidence' ) },
		} as never;
		SectionSpecsStore.load( outputDir ).set( 'https://example.com/', [ spec ], [] );
		SectionSpecsStore.load( outputDir ).set( 'https://example.com/about', [ spec ], [] );

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		const index = JSON.parse( readFileSync( join( outputDir, 'semantic-evidence.index.json' ), 'utf8' ) );
		const shards = index.shards.map( ( shard: { path: string } ) =>
			JSON.parse( readFileSync( join( outputDir, shard.path ), 'utf8' ) )
		);
		expect( index.schema ).toBe( INDEXED_SEMANTIC_EVIDENCE_SCHEMA );
		expect( shards ).toHaveLength( 2 );
		const pages = shards.flatMap( ( shard: { pages: unknown[] } ) => shard.pages ) as Array< {
			path: string;
			viewports: { desktop: Array< { headings: string[] } > };
		}>;
		expect( pages.map( ( page ) => page.path ) ).toEqual( [
			'website/index.html',
			'website/about/index.html',
		] );
		expect( pages.map( ( page ) => page.viewports.desktop[ 0 ].headings ) ).toEqual( [
			[ 'Caminos y sabores 🍜' ],
			[ 'Caminos y sabores 🍜' ],
		] );
		expect( Buffer.byteLength( JSON.stringify( pages ) ) ).toBeGreaterThan( 10 * 1024 * 1024 );
		for ( const shard of shards )
			expect( Buffer.byteLength( JSON.stringify( shard ) ) ).toBeLessThanOrEqual( 10 * 1024 * 1024 );
		const first = [ index, ...shards ].map( ( value ) => JSON.stringify( value ) );
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );
		const repeatedIndex = JSON.parse( readFileSync( join( outputDir, 'semantic-evidence.index.json' ), 'utf8' ) );
		const repeated = [
			repeatedIndex,
			...repeatedIndex.shards.map( ( shard: { path: string } ) =>
				JSON.parse( readFileSync( join( outputDir, shard.path ), 'utf8' ) )
			),
		].map( ( value ) => JSON.stringify( value ) );
		expect( repeated ).toEqual( first );
	} );

	it( 'preserves the rendered authoring tree when section reconstruction lacks visual proof', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'sections' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><title>Example Studio</title></head><body><header><a href="/">Desktop logo</a><a href="/work">Work</a></header><main><h1>Desktop duplicate</h1><img src="https://cdn.example/hero.jpg"></main><footer><a href="/privacy">Privacy</a></footer></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><body><header><a href="/">Example Studio</a><button aria-haspopup="dialog" data-modalid="contact">Contact</button><button aria-label="Menu"></button></header><main><h1>Mobile duplicate</h1></main><footer><a href="/privacy">Privacy</a></footer></body></html>'
		);
		writeFileSync( join( outputDir, 'media', 'hero.jpg' ), 'hero' );
		writeFileSync(
			join( outputDir, 'sections', 'homepage.json' ),
			JSON.stringify( {
				sourceUrl: 'https://example.com/',
				sections: [
					{
						sectionIndex: 0,
						interactionModel: 'columns',
						top: 0,
						height: 600,
						headings: [ 'Built from evidence' ],
						bodyText: [ 'One editable page tree.' ],
						buttonLabels: [],
						images: [
							{
								url: 'https://cdn.example/hero.jpg',
								sourceUrl: 'https://cdn.example/hero.jpg',
								alt: 'Project hero',
								kind: 'img',
								width: 1200,
								height: 800,
							},
						],
						icons: [],
						backgroundBrightness: 255,
						backgroundColor: 'rgb(255, 255, 255)',
						gradient: null,
						gradientSource: null,
						motionProfile: { motionClass: 'none', signals: [], animatedElements: 0 },
						dividerAbove: null,
						dividerBelow: null,
						layout: {
							containerWidth: 1200,
							padding: '0',
							childLayout: 'flex-row',
							columnCount: 2,
							gap: '24px',
						},
						cells: [
							{
								heading: 'Modeling',
								body: [ 'Precisely reconstructed.' ],
								image: null,
								icon: {
									kind: 'svg',
									markup: '<svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>',
									width: 48,
									height: 48,
								},
								button: null,
							},
							{
								heading: 'Rendering',
								body: [ 'Ready for WordPress.' ],
								image: null,
								icon: null,
								button: null,
							},
						],
					},
				],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': {
						html: 'html/homepage.html',
						sections: 'sections/homepage.json',
					},
				},
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/hero.jpg', join( outputDir, 'media', 'hero.jpg' ) );
		media.flush();

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );

		expect( html ).toContain( '<title>Example Studio</title>' );
		expect( html ).toContain( 'Desktop duplicate' );
		expect( html ).toContain( 'Mobile duplicate' );
		expect( html ).toContain( 'src="/media/hero.jpg"' );
		expect( html ).not.toContain( '<!-- wp:' );
		expect( html ).toContain( 'data-liberation-desktop-document' );
		expect( html ).toContain( 'data-liberation-mobile-document' );
		expect( receipt.assets ).not.toContainEqual(
			expect.objectContaining( { sourceUrl: expect.stringContaining( '#generated-icon-' ) } )
		);
	} );

	it( 'keeps captured responsive HTML when section evidence is invalid', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'sections' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><main><h1>Desktop capture</h1></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><main><h1>Mobile capture</h1></main><nav>Menu</nav></body></html>'
		);
		writeFileSync( join( outputDir, 'sections', 'homepage.json' ), '{invalid' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': {
						html: 'html/homepage.html',
						sections: 'sections/homepage.json',
					},
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'Desktop capture' );
		expect( html ).toContain( 'Mobile capture' );
		expect( html ).toContain( 'data-liberation-desktop-document' );
		expect( html ).toContain( 'data-liberation-mobile-document' );
	} );

	it( 'keeps one authoring body when responsive captures differ only in presentation', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head></head><body><!-- desktop note --><canvas id="canvas" width="1440" height="900"></canvas><main class="desktop" style="width:900px"><img src="/hero-large.jpg"><h1>Home</h1><p id="runtime-status">Ready</p></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><head></head><body><canvas id="canvas" width="390" height="844"></canvas><main class="mobile" style="width:390px"><img src="/hero-small.jpg"><h1>Home</h1><p id="runtime-status">Synchronizing...</p><div class="runtime-mount"></div></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html ).not.toContain( 'data-liberation-mobile-document' );
		expect( html ).toContain( 'class="desktop"' );
		expect( html ).not.toContain( 'class="mobile"' );
		expect( html ).toContain( '<canvas id="canvas" width="1440" height="900"></canvas>' );
	} );

	it( 'preserves mobile styles when matching responsive bodies style themselves differently', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><style>main{color:blue}</style><style media="print">main{margin:0}</style></head><body><main><h1>Home</h1></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>main{color:red}</style></head><body><main><h1>Home</h1></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html ).not.toContain( 'data-liberation-mobile-document' );
		expect( html ).toContain( '<style media="(min-width:769px)">main{color:blue}</style>' );
		expect( html ).toContain(
			'<style media="(min-width:769px) and (print)">main{margin:0}</style>'
		);
		expect( html ).toContain( '<style media="(max-width:768px)">main{color:red}</style>' );
		expect( html ).toContain( 'name="viewport"' );
	} );

	it( 'keeps shared styles unwrapped when matching responsive bodies style themselves identically', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const document =
			'<!doctype html><html><head><style>main{color:blue}</style></head><body><main><h1>Home</h1></main></body></html>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), document );
		writeFileSync( join( outputDir, 'html-mobile', 'homepage.html' ), document );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html ).not.toContain( 'data-liberation-mobile-document' );
		expect( html ).toContain( '<style>main{color:blue}</style>' );
		expect( html ).not.toContain( '(min-width:769px)' );
		expect( html ).not.toContain( '(max-width:768px)' );
	} );

	it( 'shares identical responsive styles when both authoring bodies are required', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const sharedStyle =
			'<style media="screen and (min-width: 1px)">.layout{display:grid}@media(max-width:600px){.layout{display:block}}</style>';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<!doctype html><html><head>${ sharedStyle }</head><body><main class="layout"><h1>Home</h1><a href="/about">About</a><aside>Desktop navigation</aside></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<!doctype html><html><head>${ sharedStyle }</head><body><main class="layout"><button>Menu</button><h1>Home</h1><a href="/about">About</a></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			`<!doctype html><html><head>${ sharedStyle }</head><body><main class="layout"><h1>About</h1><aside>Desktop navigation</aside></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'about.html' ),
			`<!doctype html><html><head>${ sharedStyle }</head><body><main class="layout"><button>Menu</button><h1>About</h1></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'data-liberation-desktop-document' );
		expect( html ).toContain( 'data-liberation-mobile-document' );
		expect( html.match( /capture-[a-f0-9]{64}\.css/g ) ).toHaveLength( 2 );
		expect( html ).toContain( 'media="screen and (min-width: 1px)"' );
		expect( html ).not.toContain( ':where(.data-liberation-mobile-document) .layout' );
		expect( html ).toContain( '/assets/css/capture-' );
	} );

	it( 'keeps a stylesheet the mobile capture also contains applying below the switch width', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const sharedStyle = '<style>.shared{color:green}</style>';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<!doctype html><html><head>${ sharedStyle }<style>.desktop-only{color:blue}</style></head><body><main><h1>Home</h1><aside>Desktop navigation</aside></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			`<!doctype html><html><head>${ sharedStyle }<style>.mobile-only{color:red}</style></head><body><main><button>Menu</button><h1>Home</h1></main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'data-liberation-desktop-document' );
		expect( html ).toContain( 'data-liberation-mobile-document' );
		// Present in both captures: must apply at every width, not be gated to desktop.
		expect( html ).toContain( '<style>.shared{color:green}</style>' );
		expect( html ).not.toContain( '<style media="(min-width:769px)">.shared{color:green}</style>' );
		// Unique to one capture: stays scoped to the branch that produced it.
		expect( html ).toContain( '<style media="(min-width:769px)">.desktop-only{color:blue}</style>' );
		expect( html ).toContain( ':where(.data-liberation-mobile-document) .mobile-only{color:red}' );
	} );

	it.each( [ false, true ] )( 'preserves mobile linked styles and their cascade when dual documents are %s', async ( dual ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-responsive-linked-css-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots', 'resources/css' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const common = '<link rel="stylesheet" href="https://cdn.example/shared.css">';
		const body = '<main><div class="bar">Call Map Hours</div></main>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ),
			`<html><head>${ common }</head><body>${ body }${ dual ? '<aside>Desktop navigation</aside>' : '' }</body></html>` );
		writeFileSync( join( outputDir, 'html-mobile', 'homepage.html' ),
			`<html><head><link rel="stylesheet" href="https://cdn.example/widget.css">${ common }<link rel="stylesheet" media="screen and (min-width:300px), print" href="https://cdn.example/labels.css"><link rel="stylesheet" disabled href="https://cdn.example/disabled.css"></head><body>${ body }</body></html>` );
		const styles = {
			'widget.css': '.bar{position:fixed;bottom:0;height:64px;background:red;color:green}',
			'shared.css': '.bar{background:rgb(235,235,235);color:blue}',
			'labels.css': '.bar{text-transform:uppercase;color:purple}',
			'disabled.css': '.bar{display:none}',
		};
		const resources: Record< string, { path: string; contentType: string } > = {};
		for ( const [ name, css ] of Object.entries( styles ) ) {
			writeFileSync( join( outputDir, 'resources/css', name ), css );
			resources[ `https://cdn.example/${ name }` ] = { path: `resources/css/${ name }`, contentType: 'text/css' };
		}
		writeFileSync( join( outputDir, 'resources/manifest.json' ), JSON.stringify( { version: 1, resources, failures: [] } ) );
		writeFileSync( join( outputDir, 'screenshots/manifest.json' ), JSON.stringify( {
			version: 1, entries: { 'https://example.com/': { html: 'html/homepage.html' } },
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const browser = await chromium.launch();
		try {
			const page = await browser.newPage( { viewport: { width: 390, height: 844 } } );
			await page.route( 'https://portable.test/**', route => {
				const pathname = new URL( route.request().url() ).pathname;
				return route.fulfill( { contentType: pathname.endsWith( '.css' ) ? 'text/css' : 'text/html',
					body: readFileSync( join( outputDir, 'website', pathname === '/' ? 'index.html' : pathname ) ) } );
			} );
			await page.goto( 'https://portable.test/' );
			const facts = () => page.locator( '.bar:visible' ).evaluate( element => {
				const style = getComputedStyle( element );
				return { position: style.position, top: element.getBoundingClientRect().top,
					background: style.backgroundColor, color: style.color, textTransform: style.textTransform };
			} );
			expect( await facts() ).toEqual( { position: 'fixed', top: 780,
				background: 'rgb(235, 235, 235)', color: 'rgb(128, 0, 128)', textTransform: 'uppercase' } );
			await page.setViewportSize( { width: 280, height: 844 } );
			expect( await facts() ).toMatchObject( { position: 'fixed', color: 'rgb(0, 0, 255)', textTransform: 'none' } );
			await page.setViewportSize( { width: 1440, height: 900 } );
			expect( await facts() ).toMatchObject( { position: 'static', color: 'rgb(0, 0, 255)', textTransform: 'none' } );
		} finally {
			await browser.close();
		}
	} );

	it( 'hoists byte-identical safe styles across 186 documents without deleting local occurrences', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const entries: Record< string, { html: string } > = {
			'https://example.com/': { html: 'html/page-0.html' },
		};
		const repeated = '<style type="text/css" media="screen">.card{color:rgb(1, 2, 3)}</style>';
		for ( let index = 0; index < 186; index++ ) {
			const slug = `page-${ index }`;
			writeFileSync(
				join( outputDir, 'html', `${ slug }.html` ),
				`<!doctype html><html><head>${ repeated }${ repeated }</head><body><p class="card">${ index }</p></body></html>`
			);
			entries[ index === 0 ? 'https://example.com/' : `https://example.com/${ slug }` ] = {
				html: `html/${ slug }.html`,
			};
		}
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( { version: 1, entries } ) );

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html.match( /<link rel="stylesheet" href="\/assets\/css\/capture-[a-f0-9]{64}\.css" media="screen">/g ) ).toHaveLength( 2 );
		expect( html ).toContain( '/assets/css/capture-' );
	} );

	it( 'keeps unsafe and base-dependent styles inline with emitted diagnostics', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-diagnostics-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const css = '<style>.hero{background:url("image.png")}</style><style nonce="runtime">.runtime{color:red}</style><style></style><style>.broken{background:url()}</style>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), `<html><head>${ css }</head><body><p class="hero runtime">Home</p></body></html>` );
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<html><head>${ css }</head><body><p class="hero runtime">About</p></body></html>` );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about/': { html: 'html/about.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'nonce="runtime"' );
		expect( html ).toContain( '<style>.hero{' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.styleHoist.diagnostics ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { reason: 'unsafe_attributes' } ),
			expect.objectContaining( { reason: 'relative_css_url' } ),
			expect.objectContaining( { reason: 'empty_style' } ),
			expect.objectContaining( { reason: 'empty_css_url' } ),
		] ) );
		expect( existsSync( join( outputDir, 'diagnostics.json' ) ) ).toBe( true );
	} );

	it( 'bounds unhoistable style diagnostics while retaining aggregate reasons', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-bounded-diagnostics-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const styles = Array.from(
			{ length: 12_000 },
			( _value, index ) => `<style nonce="runtime-${ index }">.x${ index }{color:red}</style>`
		).join( '' );
		for ( const slug of [ 'homepage', 'about' ] )
			writeFileSync( join( outputDir, 'html', `${ slug }.html` ), `<html><head>${ styles }</head><body></body></html>` );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.styleHoist.diagnosticCounts.unsafe_attributes ).toBe( 24_000 );
		expect( diagnostics.styleHoist.diagnosticsTruncated ).toBe( true );
		expect( Buffer.byteLength( JSON.stringify( diagnostics.styleHoist ) ) ).toBeLessThanOrEqual( 32 * 1024 );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( 'nonce="runtime-0"' );
	} );

	it( 'retains base- and CSP-bearing document styles inline with their original attributes', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-policy-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const baseDocument = '<html><head><base href="https://cdn.example/theme/"><style>.base{color:red}</style></head><body><p class="base">Base</p></body></html>';
		const cspDocument = '<html><head><meta http-equiv="Content-Security-Policy" content="style-src \'nonce-runtime\'"><style nonce="runtime">.csp{color:blue}</style></head><body><p class="csp">CSP</p></body></html>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), baseDocument );
		writeFileSync( join( outputDir, 'html', 'about.html' ), baseDocument );
		writeFileSync( join( outputDir, 'html', 'csp.html' ), cspDocument );
		writeFileSync( join( outputDir, 'html', 'csp-two.html' ), cspDocument );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
				'https://example.com/csp': { html: 'html/csp.html' },
				'https://example.com/csp-two': { html: 'html/csp-two.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const homepage = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const csp = readFileSync( join( outputDir, 'website', 'csp', 'index.html' ), 'utf8' );
		expect( homepage ).toContain( '<style>.base{color:red}</style>' );
		expect( csp ).toContain( '<style nonce="runtime">.csp{color:blue}</style>' );
		expect( homepage ).not.toContain( 'capture-' );
		expect( csp ).not.toContain( 'capture-' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.styleHoist.diagnostics ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { reason: 'document_base' } ),
			expect.objectContaining( { reason: 'content_security_policy' } ),
		] ) );
	} );

	it( 'hoists only CSS URLs whose new stylesheet base preserves their semantics', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-url-kinds-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const css = '<style>.safe{background:url("https://cdn.example/image.png"),url("/image.png"),url("data:image/gif;base64,AA==")}</style><style>.fragment{filter:url("#filter")}</style>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), `<html><head>${ css }</head><body><p>Home</p></body></html>` );
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<html><head>${ css }</head><body><p>About</p></body></html>` );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'capture-' );
		expect( html ).toContain( '<style>.fragment{filter:url("#filter")}</style>' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.styleHoist.diagnostics ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { reason: 'fragment_css_url' } ),
		] ) );
	} );

	it( 'still hoists styles whose only unavailable asset became the about:blank sentinel', () => {
		// The sentinel is base-independent like data: and absolute URLs. Classifying
		// it as an unknown scheme would silently disable hoisting for every document
		// that lost an asset.
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-sentinel-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const css = '<style>.safe{background:url("https://cdn.example/missing.png")}</style>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), `<html><head>${ css }</head><body><p>Home</p></body></html>` );
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<html><head>${ css }</head><body><p>About</p></body></html>` );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'capture-' );
		const href = /href="([^"]*capture-[^"]*)"/.exec( html )?.[ 1 ];
		expect( href ).toBeDefined();
		const hoisted = readFileSync( join( outputDir, 'website', href!.replace( /^\//, '' ) ), 'utf8' );
		expect( hoisted ).toContain( 'about:blank' );
	} );

	it( 'preserves computed cascade when shared styles are replaced in place', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-browser-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const source = '<!doctype html><html><head><style>.target{color:red}</style><style>.target{color:blue}</style></head><body><p class="target">Text</p></body></html>';
		for ( const slug of [ 'one', 'two' ] ) writeFileSync( join( outputDir, 'html', `${ slug }.html` ), source );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/one.html' },
				'https://example.com/one': { html: 'html/one.html' },
				'https://example.com/two': { html: 'html/two.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const browser = await chromium.launch();
		try {
			const original = await browser.newPage();
			await original.setContent( source );
			const expected = await original.locator( '.target' ).evaluate( ( element ) => getComputedStyle( element ).color );
			const exported = await browser.newPage();
			const exportedHtml = readFileSync( join( outputDir, 'website', 'one', 'index.html' ), 'utf8' );
			expect( exportedHtml.match( /href="\/assets\/css\/capture-[a-f0-9]{64}\.css"/g ) ).toHaveLength( 2 );
			await exported.route( 'https://portable.test/assets/css/**', ( route ) => {
				const pathname = new URL( route.request().url() ).pathname.slice( 1 );
				return route.fulfill( {
					contentType: 'text/css',
					body: readFileSync( join( outputDir, 'website', pathname ), 'utf8' ),
				} );
			} );
			await exported.setContent( `<base href="https://portable.test/">${ exportedHtml }` );
			expect( await exported.locator( '.target' ).evaluate( ( element ) => getComputedStyle( element ).color ) ).toBe( expected );
		} finally {
			await browser.close();
		}
	} );

	it( 'retains repeated relative CSS inline in the browser', async () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-style-hoist-relative-browser-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const source = '<!doctype html><html><head><style>.target{color:green;background-image:url("image.png")}</style></head><body><p class="target">Text</p></body></html>';
		for ( const slug of [ 'one', 'two' ] ) writeFileSync( join( outputDir, 'html', `${ slug }.html` ), source );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/one.html' },
				'https://example.com/one': { html: 'html/one.html' },
				'https://example.com/two': { html: 'html/two.html' },
			},
		} ) );
		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const exportedHtml = readFileSync( join( outputDir, 'website', 'one', 'index.html' ), 'utf8' );
		expect( exportedHtml ).toContain( '<style>.target{color:green;' );
		expect( exportedHtml ).not.toContain( 'capture-' );
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();
			await page.setContent( `<base href="https://portable.test/one/">${ exportedHtml }` );
			expect( await page.locator( '.target' ).evaluate( ( element ) => getComputedStyle( element ).color ) ).toBe( 'rgb(0, 128, 0)' );
		} finally {
			await browser.close();
		}
	} );

	it( 'does not treat JavaScript url calls as CSS dependencies', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><script>function resolve(e){return url(e)}</script></head><body><main>Example</main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( html ).not.toContain( 'function resolve(e){return url(e)}' );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
	} );

	it( 'does not treat fragment-only CSS urls as dependencies', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><style>.icon{clip-path:url(#icon-clip)}</style></head><body><svg><clipPath id="icon-clip"></clipPath></svg></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
	} );

	it( 'preserves a self-contained data: image src instead of treating it as an unresolved dependency', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const dataUri =
			"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='1em' height='1em' viewBox='0 0 256 256'%3e%3c/svg%3e";
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body><img src="${ dataUri }" width="40" height="40" alt="Trello logo"></body></html>`
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( cheerio.load( html )( 'img' ).attr( 'src' ) ).toBe( dataUri );
		expect( html ).not.toContain( 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' );
		expect( diagnostics.unresolvedDependencies ).toEqual( [] );
	} );

	it( 'removes fixed provider acquisition chrome and its matching body reservation', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head></head><body style="min-height:100%;padding-bottom:62px !important"><main><h1>Home</h1></main><div id="provider-promo" style="position:fixed !important;height:62px !important;bottom:0 !important"><a href="https://provider.example/signup">Powered by Provider. Create your own unique website. Get Started</a></div></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'provider-promo' );
		expect( html ).not.toContain( 'padding-bottom:62px' );
		expect( html ).toContain( '<h1>Home</h1>' );
	} );

	it( 'drops inert shell mounts and hidden detached navigation replicas', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><body><header><a href="/work">Work</a></header><main><h1>Home</h1><div class="layout-spacer"></div></main><div id="account-app"></div><footer style="bottom:-999px;position:fixed"></footer><div style="display:none;position:absolute"><a href="/work">Work</a></div></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'layout-spacer' );
		expect( html ).not.toContain( 'account-app' );
		expect( html ).not.toContain( 'bottom:-999px' );
		// `/work` was not captured, so the copy links it at the source.
		expect( html.match( /href="https:\/\/example\.com\/work"/g ) ).toHaveLength( 1 );
	} );

	it( 'keeps an in-flow empty footer landmark while dropping detached footer chrome', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><style>#SITE_FOOTER{height:152px;background:#eee}</style></head><body><main><h1>Home</h1></main><footer id="SITE_FOOTER" class="wixui-footer"><div class="footer-grid"><div class="footer-cell"></div></div></footer><div role="contentinfo" class="site-footer-band"></div><div id="footer-mount"></div><footer class="cookie-footer" style="position:fixed;bottom:0"></footer></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		// The band a site footer reserves is carried by CSS, so the empty
		// landmark has to survive or the page loses that height everywhere.
		expect( html ).toContain( 'SITE_FOOTER' );
		expect( html ).toContain( '<footer' );
		expect( html ).toContain( 'site-footer-band' );
		// Named scaffolding that is not a landmark, and detached footer chrome,
		// are still inert and still dropped.
		expect( html ).not.toContain( 'footer-mount' );
		expect( html ).not.toContain( 'cookie-footer' );
	} );

	it( 'collapses responsive forms whose only difference is a generated target id', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><body><main><form target="form-target-1786654426341"><label>Email<input name="email"></label></form><iframe id="form-target-1786654426341" name="form-target-1786654426341"></iframe></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><body><main><form target="form-target-1786654432586"><label>Email<input name="email"></label></form><iframe id="form-target-1786654432586" name="form-target-1786654432586"></iframe></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'data-liberation-desktop-document' );
		expect( html.match( /<form/g ) ).toHaveLength( 1 );
	} );

	it( 'exports referenced same-origin runtime dependencies and diagnoses missing ones', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', '_runtimes' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', '_json' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', '_fonts' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', '_videos' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', '.netlify', 'scripts' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', 'assets', 'css' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', 'assets', 'images' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<img src="https://example.com/hero.png"><img src="/assets/images/mobile-only.webp" srcset="/assets/images/mobile-only.webp 390w"><link rel="stylesheet" href="/assets/css/site.css"><link rel="preload" href="/_runtimes/site.js" as="script"><link rel="preload" href="/_json/site.json" as="fetch"><link rel="preload" href="/_json/missing.json" as="fetch"><style>@font-face{src:url("/_fonts/site.woff2")}@font-face{src:url("/_fonts/missing.woff2")}.hero{background:url(&quot;/assets/images/missing-background.webp&quot;)}</style><video><source src="/_videos/hero"></video><video><source src="/_videos/missing"></video><script src="/_runtimes/site.js" defer></script><script src="/.netlify/scripts/rum" async></script><script src="/_runtimes/missing-script.js" defer></script><script type="module">import { Site } from "/_runtimes/site.js"; import "/_runtimes/missing.js";</script>'
		);
		writeFileSync( join( outputDir, 'media', 'hero.png' ), 'png' );
		writeFileSync( join( outputDir, 'resources', '_runtimes', 'site.js' ), 'export class Site {}' );
		writeFileSync(
			join( outputDir, 'resources', '_json', 'site.json' ),
			'{"image":"https://example.com/hero.png"}'
		);
		writeFileSync( join( outputDir, 'resources', '_fonts', 'site.woff2' ), 'font' );
		writeFileSync( join( outputDir, 'resources', '_videos', 'hero.mp4' ), 'video' );
		writeFileSync( join( outputDir, 'resources', '.netlify', 'scripts', 'rum' ), 'rum();' );
		writeFileSync(
			join( outputDir, 'resources', 'assets', 'css', 'site.css' ),
			'.hero{background:url("../images/hero.webp")}.missing{background:url("../images/missing.webp")}'
		);
		writeFileSync( join( outputDir, 'resources', 'assets', 'images', 'hero.webp' ), 'webp' );
		writeFileSync(
			join( outputDir, 'resources', 'assets', 'images', 'mobile-only.webp' ),
			'mobile'
		);
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					'https://example.com/_runtimes/site.js': {
						path: 'resources/_runtimes/site.js',
						contentType: 'text/javascript',
					},
					'https://example.com/_json/site.json': {
						path: 'resources/_json/site.json',
						contentType: 'application/json',
					},
					'https://example.com/_fonts/site.woff2': {
						path: 'resources/_fonts/site.woff2',
						contentType: 'font/woff2',
					},
					'https://example.com/_videos/hero': {
						path: 'resources/_videos/hero.mp4',
						contentType: 'video/mp4',
					},
					'https://example.com/.netlify/scripts/rum': {
						path: 'resources/.netlify/scripts/rum',
						contentType: 'application/javascript; charset=UTF-8',
					},
					'https://example.com/assets/css/site.css': {
						path: 'resources/assets/css/site.css',
						contentType: 'text/css',
					},
					'https://example.com/assets/images/hero.webp': {
						path: 'resources/assets/images/hero.webp',
						contentType: 'image/webp',
					},
					'https://example.com/assets/images/mobile-only.webp': {
						path: 'resources/assets/images/mobile-only.webp',
						contentType: 'image/webp',
					},
				},
				failures: [],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://example.com/hero.png', join( outputDir, 'media', 'hero.png' ) );
		media.flush();

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( readFileSync( join( outputDir, 'website', '_fonts', 'site.woff2' ), 'utf8' ) ).toBe(
			'font'
		);
		expect(
			readFileSync( join( outputDir, 'website', 'assets', 'css', 'site.css' ), 'utf8' )
		).toBe(
			'.hero{background:url("/assets/images/hero.webp")}.missing{background:url("about:blank")}'
		);
		expect(
			readFileSync( join( outputDir, 'website', 'assets', 'images', 'hero.webp' ), 'utf8' )
		).toBe( 'webp' );
		expect(
			readFileSync( join( outputDir, 'website', 'assets', 'images', 'mobile-only.webp' ), 'utf8' )
		).toBe( 'mobile' );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'srcset="/assets/images/mobile-only.webp 390w"'
		);
		expect( diagnostics.unresolvedDependencies ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( { url: 'https://example.com/_videos/missing' } ),
				expect.objectContaining( { url: 'https://example.com/_fonts/missing.woff2' } ),
				expect.objectContaining( {
					url: 'https://example.com/assets/images/missing-background.webp',
				} ),
			] )
		);
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( '/_json/missing.json' );
		expect( cheerio.load( html )( 'img' ).first().attr( 'src' ) ).toBe( '/media/hero.png' );
		expect( html ).not.toContain( '/assets/images/missing-background.webp' );
		expect( html ).toContain( '<source src="/_videos/hero.mp4">' );
		expect( readFileSync( join( outputDir, 'website', '_videos', 'hero.mp4' ), 'utf8' ) ).toBe(
			'video'
		);
		// A `<source>` that could not be localized keeps its resolved source url
		// rather than losing `src` entirely — an emptied attribute would make
		// the element unrecoverable downstream (a WordPress import, say, drops
		// it), while the external reference at least survives as evidence.
		expect( html ).toContain( '<source src="https://example.com/_videos/missing">' );
		expect( html ).not.toContain( '/_fonts/missing.woff2' );
		expect( html ).toContain( 'about:blank' );
		expect( html ).not.toContain( '/_runtimes/site.js' );
		expect( html ).not.toContain( '/_runtimes/missing-script.js' );
		expect( existsSync( join( outputDir, 'diagnostics.json' ) ) ).toBe( true );
		expect( existsSync( join( outputDir, 'capture-receipt.json' ) ) ).toBe( true );
	} );

	it( 'preserves percent-encoded route segments in artifact paths and links', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<h1>Home</h1><a href="https://example.com/comms-%26-use-cases">Cases</a>'
		);
		writeFileSync( join( outputDir, 'html', 'cases.html' ), '<h1>Cases</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/comms-%26-use-cases': { html: 'html/cases.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toContainEqual( {
			url: 'https://example.com/comms-%26-use-cases',
			path: 'website/comms-%26-use-cases/index.html',
		} );
		expect(
			readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' )
		).toContain( 'href="/comms-%26-use-cases/index.html"' );
	} );

	it( 'rejects encoded route paths that escape the website directory', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<h1>Home</h1><a href="/%2e%2e%2fescape">Escape</a>'
		);
		writeFileSync( join( outputDir, 'html', 'escape.html' ), '<h1>Escape</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/%2e%2e%2fescape': { html: 'html/escape.html' },
				},
			} )
		);

		expect( () =>
			exportWebsiteCapture( {
				outputDir,
				sourceUrl: 'https://example.com/',
				platform: 'fake',
				summary: {},
				failures: [],
			} )
		).toThrow( 'escapes the website directory' );
	} );

	it( 'uses a route whose canonical URL identifies it as the source homepage', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<h1>Canonical home</h1><a href="/shop/about">About</a><a href="/downloads/guide.pdf">Guide</a>'
		);
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
		writeFileSync( join( outputDir, 'html', 'orphan.html' ), '<h1>Unlinked draft</h1>' );
		writeFileSync( join( outputDir, 'html', 'guide.html' ), '<h1>Download guide</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/shop/home': {
						html: 'html/home.html',
						metadata: { openGraph: { 'og:url': 'https://example.com/shop' } },
					},
					'https://example.com/shop/about': { html: 'html/about.html' },
					'https://example.com/shop/orphan': { html: 'html/orphan.html' },
					'https://example.com/downloads/guide.pdf': { html: 'html/guide.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/shop',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/shop/home', path: 'website/index.html' },
			{ url: 'https://example.com/shop/about', path: 'website/about/index.html' },
			{ url: 'https://example.com/shop/orphan', path: 'website/orphan/index.html' },
			{ url: 'https://example.com/downloads/guide.pdf', path: 'website/downloads/guide.pdf' },
		] );
		expect( receipt.excludedRoutes ).toEqual( [] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'Canonical home'
		);
		expect(
			readFileSync( join( outputDir, 'website', 'orphan', 'index.html' ), 'utf8' )
		).toContain( 'Unlinked draft' );
		expect(
			readFileSync( join( outputDir, 'website', 'downloads', 'guide.pdf' ), 'utf8' )
		).toContain( 'Download guide' );
	} );

	it( 'names a route that never produced HTML instead of silently dropping it', () => {
		// Reproduces the anniefinneran.weebly.com nondeterminism: discovery finds
		// the same routes every run, but a route can still fail during the
		// browser capture stage (a `page.goto` timeout, here) and previously
		// vanished from the receipt with no trace — routesDiscovered stayed 29
		// while routes.length silently dropped, and nothing named which route
		// or why. The manifest reflects that outcome directly: the failed
		// route has no `html` key, exactly like a real timed-out capture.
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/home.html' },
					// No `html` key: capturePerViewport's desktop goto attempts all
					// timed out, so entry.html was never set.
					'https://example.com/photos.html': {},
				},
			} )
		);

		// Shaped like the real FailureEntry from screenshots/failures.json (url,
		// viewport, stage, error, ...), but the export function only depends on
		// the loose {url,error} contract it declares.
		const failures: Array< { url: string; viewport: string; stage: string; error: string } > = [
			{
				url: 'https://example.com/photos.html',
				viewport: 'desktop',
				stage: 'goto',
				error: 'page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://example.com/photos.html"',
			},
			{
				url: 'https://example.com/photos.html',
				viewport: 'mobile',
				stage: 'goto',
				error: 'page.goto: Timeout 30000ms exceeded.',
			},
		];
		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures,
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/', path: 'website/index.html' },
		] );
		expect( receipt.discoveryDiagnostics ).toEqual( [
			{
				code: 'route_capture_failed',
				url: 'https://example.com/photos.html',
				reason:
					'desktop/goto: page.goto: Timeout 30000ms exceeded.; mobile/goto: page.goto: Timeout 30000ms exceeded.',
			},
		] );

		const diagnostics = JSON.parse(
			readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' )
		);
		expect( diagnostics.discoveryDiagnostics ).toEqual( receipt.discoveryDiagnostics );
	} );

	it( 'names a discovered HTTP 404 as route_not_found instead of a capture failure', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/home.html' },
					'https://example.com/shop/p/the-echo-vase': {},
				},
			} )
		);

		const failures: Array< { url: string; viewport: string; stage: string; error: string } > = [
			{
				url: 'https://example.com/shop/p/the-echo-vase',
				viewport: 'desktop',
				stage: 'goto',
				error: 'HTTP 404',
			},
			{
				url: 'https://example.com/shop/p/the-echo-vase',
				viewport: 'mobile',
				stage: 'goto',
				error: 'HTTP 404',
			},
		];
		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: { routesFailed: 0, routesSkipped: 1 },
			failures,
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/', path: 'website/index.html' },
		] );
		expect( receipt.excludedRoutes ).toEqual( [ 'https://example.com/shop/p/the-echo-vase' ] );
		expect( receipt.discoveryDiagnostics ).toEqual( [
			{
				code: 'route_not_found',
				url: 'https://example.com/shop/p/the-echo-vase',
				reason: 'desktop/goto: HTTP 404; mobile/goto: HTTP 404',
			},
		] );
		expect( receipt.summary.routesFailed ).toBe( 0 );
	} );

	it.each( [ 404, 410, 'rendered 404' ] )( 'reports a source-absent %s link without failing capture or cleanup completeness', ( absence ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-source-absence-' ) );
		dirs.push( outputDir );
		for ( const dir of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, dir ), { recursive: true } );
		const sourceUrl = 'https://example.com/';
		const absentUrl = 'https://example.com/gone.html';
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1><a href="gone.html#details">Gone</a>' );
		writeFileSync( join( outputDir, 'html', 'gone.html' ), '<h1>404</h1><p>Page not found</p>' );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: {
				[ sourceUrl ]: { html: 'html/home.html', cleanup: { policy: cleanupPolicy(), reports: [ { failures: [], residual: 0 } ] } },
				[ absentUrl ]: absence === 'rendered 404' ? { html: 'html/gone.html' } : {},
			},
		} ) );
		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir, sourceUrl, platform: 'generic', summary: { routesFailed: 0 },
			failures: absence === 'rendered 404' ? [] : [ { url: absentUrl, error: `HTTP ${ absence }` } ],
		} ), 'utf8' ) );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( receipt.cleanup.complete ).toBe( true );
		expect( receipt.summary.complete ).toBe( true );
		expect( diagnostics.complete ).toBe( true );
		expect( receipt.excludedRoutes ).toEqual( [ absentUrl ] );
		expect( receipt.discoveryDiagnostics ).toEqual( [ expect.objectContaining( { code: 'route_not_found', url: absentUrl } ) ] );
		expect( diagnostics.unresolvedAnchors ).toEqual( [ { sourceUrl, url: absentUrl, reason: 'target route is absent at source' } ] );
		expect( JSON.parse( readFileSync( join( outputDir, 'cleanup-evidence.json' ), 'utf8' ) ).pages.map( ( page: { url: string } ) => page.url ) ).toEqual( [ sourceUrl ] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( 'href="https://example.com/gone.html#details"' );
	} );

	it.each( [ 'missing policy', 'missing reports', 'failure', 'residual', 'different policy' ] )( 'still fails cleanup for an exported page with %s', ( problem ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-retained-cleanup-' ) );
		dirs.push( outputDir );
		for ( const dir of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, dir ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'other.html' ), '<h1>Other</h1>' );
		const policy = cleanupPolicy();
		const reports = [ { failures: [] as string[], residual: 0 } ];
		const cleanup = {
			...( problem === 'missing policy' ? {} : { policy: problem === 'different policy' ? { ...policy, rules: [] } : policy } ),
			...( problem === 'missing reports' ? {} : { reports: [ {
				failures: problem === 'failure' ? [ 'cleanup failed' ] : [], residual: problem === 'residual' ? 1 : 0,
			} ] } ),
		};
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: {
				'https://example.com/': { html: 'html/home.html', cleanup: { policy, reports } },
				'https://example.com/other': { html: 'html/other.html', cleanup },
			},
		} ) );
		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [],
		} ), 'utf8' ) );
		expect( receipt.cleanup.complete ).toBe( false );
	} );

	it.each( [ 'https://example.com/sitemap-only', 'https://example.com/gone?view=current' ] )( 'keeps missing cleanup evidence blocking for unlinked route %s', ( missingUrl ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-missing-capture-cleanup-' ) );
		dirs.push( outputDir );
		for ( const dir of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, dir ), { recursive: true } );
		const sourceUrl = 'https://example.com/';
		const absentUrl = 'https://example.com/gone?view=removed';
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: {
				[ sourceUrl ]: { html: 'html/home.html', cleanup: { policy: cleanupPolicy(), reports: [ { failures: [], residual: 0 } ] } },
				[ missingUrl ]: { html: 'html/missing.html' },
				[ absentUrl ]: {},
			},
		} ) );
		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir, sourceUrl, platform: 'generic', summary: { routesFailed: 0 }, failures: [ { url: absentUrl, error: 'HTTP 404' } ],
		} ), 'utf8' ) );
		expect( receipt.cleanup.complete ).toBe( false );
		expect( receipt.excludedRoutes ).toEqual( [ absentUrl ] );
		expect( receipt.discoveryDiagnostics ).toContainEqual( expect.objectContaining( { code: 'route_capture_failed', url: missingUrl } ) );
		expect( JSON.parse( readFileSync( join( outputDir, 'cleanup-evidence.json' ), 'utf8' ) ).pages.map( ( page: { url: string } ) => page.url ) ).toContain( missingUrl );
	} );

	it.each( [ 'HTTP 500', 'Timeout exceeded', 'mixed 404 and timeout', 'unattempted' ] )( 'does not call an uncaptured %s route absent at source', ( error ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-unproven-absence-' ) );
		dirs.push( outputDir );
		for ( const dir of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, dir ), { recursive: true } );
		const sourceUrl = 'https://example.com/';
		const url = 'https://example.com/other';
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1><a href="/other">Other</a>' );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: { [ sourceUrl ]: { html: 'html/home.html' }, ...( error === 'unattempted' ? {} : { [ url ]: {} } ) },
		} ) );
		const failures = error === 'unattempted' ? [] : error === 'mixed 404 and timeout'
			? [ { url, error: 'HTTP 404' }, { url, error: 'Timeout exceeded' } ] : [ { url, error } ];
		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir, sourceUrl, platform: 'generic', summary: { routesFailed: 0 }, failures,
		} ), 'utf8' ) );
		expect( receipt.excludedRoutes ).toEqual( [] );
		expect( receipt.summary.complete ).toBe( false );
		expect( JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) ).unresolvedAnchors ).toEqual( [ {
			sourceUrl, url, reason: 'target route was not captured',
		} ] );
	} );

	it( 'excludes a client-routed SPA not-found screen served as HTTP 200, unlike a real thin route', () => {
		// Reproduces https://mint-brand-vote.base44.app/Home: every route answers
		// HTTP 200 (there is no failure for failuresAreAbsentDocument to see), and
		// /Favorites, /SellerProfile each render the app's own generic not-found
		// template -- <h1>404</h1> plus a couple of short lines -- parameterized
		// only by the route name the visitor asked for. A real thin route (here,
		// an "Access Denied" gate) must survive untouched.
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		const notFoundHtml = ( routeName: string ) =>
			`<html><body><div class="text-center"><h1>404</h1><h2>Page Not Found</h2>` +
			`<p>The page "${ routeName }" could not be found in this application.</p>` +
			`<button>Go Home</button></div></body></html>`;
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<html><body><h1>Real Home</h1><p>Welcome to the real homepage, with real content on it.</p></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html', 'admin.html' ),
			'<html><body><h1>Access Denied</h1></body></html>'
		);
		writeFileSync( join( outputDir, 'html', 'favorites.html' ), notFoundHtml( 'Favorites' ) );
		writeFileSync( join( outputDir, 'html', 'sellerprofile.html' ), notFoundHtml( 'SellerProfile' ) );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/Home': { html: 'html/home.html' },
					'https://example.com/AdminDashboard': { html: 'html/admin.html' },
					'https://example.com/Favorites': { html: 'html/favorites.html' },
					'https://example.com/SellerProfile': { html: 'html/sellerprofile.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/Home',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes.map( ( r: { url: string } ) => r.url ) ).toEqual( [
			'https://example.com/Home',
			'https://example.com/AdminDashboard',
		] );
		expect( receipt.excludedRoutes ).toEqual( [
			'https://example.com/Favorites',
			'https://example.com/SellerProfile',
		] );
		expect( receipt.discoveryDiagnostics ).toEqual( [
			{
				code: 'route_not_found',
				url: 'https://example.com/Favorites',
				reason:
					'rendered document is the client-routed not-found screen: a heading of just "404"/"410" on an otherwise thin page',
			},
			{
				code: 'route_not_found',
				url: 'https://example.com/SellerProfile',
				reason:
					'rendered document is the client-routed not-found screen: a heading of just "404"/"410" on an otherwise thin page',
			},
		] );
		expect( existsSync( join( outputDir, 'website', 'Favorites', 'index.html' ) ) ).toBe( false );
		expect( existsSync( join( outputDir, 'website', 'SellerProfile', 'index.html' ) ) ).toBe( false );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'Real Home'
		);
		expect(
			readFileSync( join( outputDir, 'website', 'AdminDashboard', 'index.html' ), 'utf8' )
		).toContain( 'Access Denied' );
	} );

	it( 'names a route whose HTML file went missing on disk after capture claimed success', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/home.html' },
					// Manifest claims success, but the file it points at never
					// landed on disk (or was since removed).
					'https://example.com/gone.html': { html: 'html/gone.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/', path: 'website/index.html' },
		] );
		expect( receipt.discoveryDiagnostics ).toEqual( [
			{
				code: 'route_capture_failed',
				url: 'https://example.com/gone.html',
				reason: 'captured HTML file is missing or outside the output directory: html/gone.html',
			},
		] );
	} );

	it( 'passes through discovery-time diagnostics alongside capture-time route failures', () => {
		// Extends the existing sitemap-rejection diagnostics (fetchSitemapWithDiagnostics)
		// rather than adding a second, parallel reporting mechanism: both discovery-time
		// and capture-time route losses are reported through the same {code,url,reason}
		// list in the receipt and diagnostics.json.
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/home.html' } },
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			discoveryDiagnostics: [
				{
					code: 'sitemap_url_rejected',
					url: 'https://other-origin.example/page',
					reason: 'origin differs from the entry URL',
				},
			],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.discoveryDiagnostics ).toEqual( [
			{
				code: 'sitemap_url_rejected',
				url: 'https://other-origin.example/page',
				reason: 'origin differs from the entry URL',
			},
		] );
	} );

	it( 'uses rendered Open Graph metadata when the manifest metadata is absent', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<html><head><meta property="og:url" content="https://example.com"></head><body><h1>Canonical home</h1><a href="/about">About</a></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			'<html><head><meta property="og:url" content="https://example.com/about"></head><body><h1>About</h1></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/home': { html: 'html/home.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).routes ).toEqual( [
			{ url: 'https://example.com/home', path: 'website/index.html' },
			{ url: 'https://example.com/about', path: 'website/about/index.html' },
		] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'Canonical home'
		);
	} );

	it( 'resolves relative manifest Open Graph canonical URLs and rewrites their aliases', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<h1>Home</h1><a href="https://example.com/docs/company">Company</a>'
		);
		writeFileSync( join( outputDir, 'html', 'team.html' ), '<h1>Team</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/home': {
						html: 'html/home.html',
						metadata: { openGraph: { 'og:url': '/' } },
					},
					'https://example.com/docs/team': {
						html: 'html/team.html',
						metadata: { openGraph: { 'og:url': './company' } },
					},
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).routes ).toEqual( [
			{ url: 'https://example.com/home', path: 'website/index.html' },
			{ url: 'https://example.com/docs/team', path: 'website/docs/team/index.html' },
		] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/docs/team/index.html"'
		);
	} );

	it( 'roots the export at a discovered origin even when the entry is a deep link', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<h1>Home</h1><a href="/social-kit">Kit</a>'
		);
		writeFileSync(
			join( outputDir, 'html', 'kit.html' ),
			'<h1>Kit</h1><a href="/">Home</a><a href="./">Same dir</a>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/social-kit': { html: 'html/kit.html' },
					'https://example.com/': { html: 'html/home.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/social-kit',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.entrypoint ).toBe( 'website/index.html' );
		expect( receipt.websiteRoot ).toBe( 'website' );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/social-kit', path: 'website/social-kit/index.html' },
			{ url: 'https://example.com/', path: 'website/index.html' },
		] );
		expect( receipt.routes.some( ( route: { path: string } ) => route.path.includes( 'site-root' ) ) ).toBe(
			false
		);
		expect( existsSync( join( outputDir, 'website', 'site-root' ) ) ).toBe( false );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( '<h1>Home</h1>' );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/social-kit/index.html"'
		);
		expect( readFileSync( join( outputDir, 'website', 'social-kit', 'index.html' ), 'utf8' ) ).toContain(
			'<h1>Kit</h1>'
		);
		expect( readFileSync( join( outputDir, 'website', 'social-kit', 'index.html' ), 'utf8' ) ).toContain(
			'href="/index.html"'
		);
	} );

	it( 'rebases relative links in documents captured under a subpath', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'css.html' ), '<h1 id="box">CSS</h1>' );
		writeFileSync(
			join( outputDir, 'html', 'interactive.html' ),
			[
				'<h1 id="top">Interactive</h1>',
				'<a href="/bootcamp/">Root-relative home</a>',
				'<a href="/bootcamp/css">Root-relative route</a>',
				'<a href="./css?from=nav#box">Document-relative route</a>',
				'<a href="../bootcamp/css">Parent-relative route</a>',
				'<map><area href="css" alt="Area route"></map>',
				'<a href="./luna.zip">Uncaptured download</a>',
				'<a href="../elsewhere/page?x=1#y">Uncaptured outside the subpath</a>',
				'<a href="#top">Fragment</a>',
				'<a href="mailto:hi@example.com">Mail</a>',
				'<a href="tel:+15555550100">Call</a>',
				'<a href="https://external.example/bootcamp/css">External</a>',
				'<a href="/bootcamp/static/zoom.png"><img src="/bootcamp/static/zoom.png"></a>',
			].join( '' )
		);
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		writeFileSync( join( outputDir, 'media', 'zoom.png' ), 'zoom' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess(
			'https://example.com/bootcamp/static/zoom.png',
			join( outputDir, 'media', 'zoom.png' )
		);
		media.flush();
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/bootcamp/': { html: 'html/home.html' },
					'https://example.com/bootcamp/css': { html: 'html/css.html' },
					'https://example.com/bootcamp/interactive': { html: 'html/interactive.html' },
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/bootcamp/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'interactive', 'index.html' ), 'utf8' );
		expect( html ).toContain( '<a href="/index.html">Root-relative home</a>' );
		expect( html ).toContain( '<a href="/css/index.html">Root-relative route</a>' );
		expect( html ).toContain(
			'<a href="/css/index.html?from=nav#box">Document-relative route</a>'
		);
		expect( html ).toContain( '<a href="/css/index.html">Parent-relative route</a>' );
		expect( html ).toContain( '<area href="/css/index.html" alt="Area route">' );
		expect( html ).toContain(
			'<a href="https://example.com/bootcamp/luna.zip">Uncaptured download</a>'
		);
		expect( html ).toContain(
			'<a href="https://example.com/elsewhere/page?x=1#y">Uncaptured outside the subpath</a>'
		);
		expect( html ).toContain( '<a href="#top">Fragment</a>' );
		expect( html ).toContain( '<a href="mailto:hi@example.com">Mail</a>' );
		expect( html ).toContain( '<a href="tel:+15555550100">Call</a>' );
		expect( html ).toContain( '<a href="https://external.example/bootcamp/css">External</a>' );
		// A link to media the export localized keeps pointing at the local copy.
		expect( html ).toContain( '<a href="/media/zoom.png"><img src="/media/zoom.png"></a>' );
		expect( html ).not.toContain( 'href="/bootcamp' );
	} );

	it( 'resolves relative rendered Open Graph canonical URLs and rewrites their aliases', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'home.html' ),
			'<meta property="og:url" content="/"><h1>Home</h1><a href="https://example.com/docs/company">Company</a>'
		);
		writeFileSync(
			join( outputDir, 'html', 'team.html' ),
			'<meta property="og:url" content="./company"><h1>Team</h1>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/home': { html: 'html/home.html' },
					'https://example.com/docs/team': { html: 'html/team.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).routes ).toEqual( [
			{ url: 'https://example.com/home', path: 'website/index.html' },
			{ url: 'https://example.com/docs/team', path: 'website/docs/team/index.html' },
		] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/docs/team/index.html"'
		);
	} );

	it( 'ignores malformed and unsupported canonical metadata without weakening route collision safety', () => {
		for ( const canonicalUrl of [ '', 'mailto:hello@example.com', 'https://[invalid' ] ) {
			const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
			dirs.push( outputDir );
			mkdirSync( join( outputDir, 'html' ), { recursive: true } );
			mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
			writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
			writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
			writeFileSync( join( outputDir, 'html', 'about-slash.html' ), '<h1>About us</h1>' );
			writeFileSync(
				join( outputDir, 'screenshots', 'manifest.json' ),
				JSON.stringify( {
					version: 1,
					entries: {
						'https://example.com/': { html: 'html/homepage.html' },
						'https://example.com/about': { html: 'html/about.html' },
						'https://example.com/about/': {
							html: 'html/about-slash.html',
							metadata: { openGraph: { 'og:url': canonicalUrl } },
						},
					},
				} )
			);

			expect( () =>
				exportWebsiteCapture( {
					outputDir,
					sourceUrl: 'https://example.com/',
					platform: 'fake',
					summary: {},
					failures: [],
				} )
			).toThrow( 'Captured routes resolve to the same website path: about/index.html' );
		}
	} );

	it( 'prefers the exact source route over stale canonical metadata on another route', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<a href="https://example.com/">Home</a><h1>Exact home</h1>'
		);
		writeFileSync(
			join( outputDir, 'html', 'projects.html' ),
			'<meta property="og:url" content="https://example.com"><h1>Projects</h1>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/projects': { html: 'html/projects.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/', path: 'website/index.html' },
			{ url: 'https://example.com/projects', path: 'website/projects/index.html' },
		] );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="/index.html"'
		);
	} );

	it( 'keeps one route when an alternate address declares the claimed route as canonical', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<meta property="og:url" content="https://example.com/"><script type="application/ld+json">{"@type":"WebSite"}</script><h1>Home</h1><a href="https://example.com/about">About</a>'
		);
		writeFileSync(
			join( outputDir, 'html', 'index.html.html' ),
			'<meta property="og:url" content="https://example.com/"><script type="application/ld+json">{"@type":"Organization"}</script><h1>Home</h1>'
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			'<h1>About</h1><a href="https://example.com/index.html">Home</a>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/index.html': { html: 'html/index.html.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/', path: 'website/index.html' },
			{ url: 'https://example.com/about', path: 'website/about/index.html' },
		] );
		expect( receipt.duplicateRoutes ).toEqual( [
			{
				url: 'https://example.com/index.html',
				canonicalUrl: 'https://example.com/',
				path: 'website/index.html',
			},
		] );
		const homepage = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( homepage.html() ).toContain( '<h1>Home</h1>' );
		expect( homepage( 'script[type="application/ld+json"]' ) ).toHaveLength( 2 );
		expect( homepage( 'script[type="application/ld+json"]' ).map( ( _, script ) => JSON.parse( homepage( script ).text() )[ '@type' ] ).get() ).toEqual( [ 'WebSite', 'Organization' ] );
		expect( readFileSync( join( outputDir, 'website', 'about', 'index.html' ), 'utf8' ) ).toContain(
			'href="/index.html"'
		);
	} );

	it.each( [
		{ directory: '/', explicitSource: false, reversed: false, reservedDirectory: false },
		{ directory: '/', explicitSource: false, reversed: true, reservedDirectory: false },
		{ directory: '/', explicitSource: true, reversed: false, reservedDirectory: false },
		{ directory: '/', explicitSource: true, reversed: true, reservedDirectory: false },
		{ directory: '/docs/', explicitSource: false, reversed: true, reservedDirectory: false },
		{ directory: '/', explicitSource: false, reversed: true, reservedDirectory: true },
	] )( 'preserves distinct default-document captures: %j', ( { directory, explicitSource, reversed, reservedDirectory } ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-default-document-' ) );
		dirs.push( outputDir );
		for ( const dir of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, dir ), { recursive: true } );
		const directoryUrl = `https://example.com${ directory }`;
		const documentUrl = `${ directoryUrl }index.html`;
		const reservedRoute = reservedDirectory ? 'index-2.html/child' : 'index-2.html';
		const reservedPath = reservedDirectory ? 'index-2.html/child/index.html' : 'index-2.html';
		const links = `<a href="${ directory }#directory">Directory</a><a href="${ documentUrl }?from=nav#document">Document</a><a href="${ directoryUrl }${ reservedRoute }#reserved">Reserved</a>`;
		const menu = '<button id="menu" aria-haspopup="dialog">Menu</button>';
		const dialogHtml = `<nav><a href="index.html?from=menu#document">Document</a><a href="${ directory }#directory">Directory</a></nav>`;
		const interactions = ( sourceUrl: string ) => ( {
			schema: 'data-liberation/interaction-states/v2', sourceUrl,
			viewport: { width: 1440, height: 900 }, capturedAt: '2026-09-21T00:00:00Z',
			states: [ {
				status: 'captured',
				trigger: { selector: '#menu', tag: 'button', id: 'menu', ariaHaspopup: 'dialog', dataBindings: {} },
				dialog: { selector: '#menu-dialog', tag: 'nav', ariaModal: true, html: dialogHtml, htmlBytes: Buffer.byteLength( dialogHtml ), htmlTruncated: false },
			} ],
		} );
		writeFileSync( join( outputDir, 'html', 'directory.html' ), `<h1 id="directory">Directory content</h1>${ links }${ menu }` );
		writeFileSync( join( outputDir, 'html', 'document.html' ), `<h1 id="document">Different document content</h1>${ links }${ menu }<img src="https://example.com/missing.jpg">` );
		writeFileSync( join( outputDir, 'html', 'reserved.html' ), `<h1 id="reserved">Reserved filename</h1>${ links }` );
		const entries = [
			[ directoryUrl, { html: 'html/directory.html', interactions: interactions( directoryUrl ) } ],
			[ documentUrl, { html: 'html/document.html', interactions: interactions( documentUrl ) } ],
			[ `${ directoryUrl }${ reservedRoute }`, { html: 'html/reserved.html' } ],
		];
		if ( reversed ) entries.reverse();
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( { version: 1, entries: Object.fromEntries( entries ) } ) );
		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir, sourceUrl: explicitSource ? documentUrl : directoryUrl, platform: 'generic', summary: {}, failures: [],
		} ), 'utf8' ) );
		const directoryPath = explicitSource ? 'index-3.html' : 'index.html';
		const documentPath = explicitSource ? 'index.html' : 'index-3.html';
		expect( receipt.routes ).toHaveLength( 3 );
		expect( receipt.duplicateRoutes ).toEqual( [] );
		expect( Object.fromEntries( receipt.routes.map( ( route: { url: string; path: string } ) => [ route.url, route.path ] ) ) ).toEqual( {
			[ directoryUrl ]: `website/${ directoryPath }`,
			[ documentUrl ]: `website/${ documentPath }`,
			[ `${ directoryUrl }${ reservedRoute }` ]: `website/${ reservedPath }`,
		} );
		expect( receipt.entrypoint ).toBe( 'website/index.html' );
		for ( const file of [ 'index.html', reservedPath, 'index-3.html' ] ) {
			const $ = cheerio.load( readFileSync( join( outputDir, 'website', file ), 'utf8' ) );
			expect( $( 'a' ).not( '.dla-dialog a' ).map( ( _, link ) => $( link ).attr( 'href' ) ).get() ).toEqual( [
				`/${ directoryPath }#directory`, `/${ documentPath }?from=nav#document`, `/${ reservedPath }#reserved`,
			] );
			if ( file !== reservedPath ) {
				expect( $( '.dla-dialog a' ).map( ( _, link ) => $( link ).attr( 'href' ) ).get() ).toEqual( [
					`/${ documentPath }?from=menu#document`, `/${ directoryPath }#directory`,
				] );
			}
		}
		expect( readFileSync( join( outputDir, 'website', directoryPath ), 'utf8' ) ).toContain( 'Directory content' );
		expect( readFileSync( join( outputDir, 'website', documentPath ), 'utf8' ) ).toContain( 'Different document content' );
		const evidence = JSON.parse( readFileSync( join( outputDir, 'asset-evidence.json' ), 'utf8' ) );
		expect( evidence.assets[ 0 ].references[ 0 ].path ).toBe( `website/${ documentPath }` );
	} );

	it( 'pairs a query-bearing entry URL with its default-document capture by normalized URL, deduping identical content', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-default-document-query-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'homepage-index.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/?token=abc': { html: 'html/homepage.html' },
					'https://example.com/index.html': { html: 'html/homepage-index.html' },
				},
			} )
		);

		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/?token=abc',
			platform: 'generic',
			summary: {},
			failures: [],
		} ), 'utf8' ) );

		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/?token=abc', path: 'website/index.html' },
		] );
		expect( receipt.duplicateRoutes ).toEqual( [ {
			url: 'https://example.com/index.html',
			canonicalUrl: 'https://example.com/?token=abc',
			path: 'website/index.html',
		} ] );
		expect( existsSync( join( outputDir, 'website', 'index-2.html' ) ) ).toBe( false );
	} );

	it( 'pairs a fragment-bearing entry URL with its default-document capture the same way', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-default-document-fragment-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'homepage-index.html' ), '<h1>Home</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/#top': { html: 'html/homepage.html' },
					'https://example.com/index.html': { html: 'html/homepage-index.html' },
				},
			} )
		);

		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/#top',
			platform: 'generic',
			summary: {},
			failures: [],
		} ), 'utf8' ) );

		expect( receipt.routes ).toEqual( [
			{ url: 'https://example.com/#top', path: 'website/index.html' },
		] );
		expect( receipt.duplicateRoutes ).toEqual( [ {
			url: 'https://example.com/index.html',
			canonicalUrl: 'https://example.com/#top',
			path: 'website/index.html',
		} ] );
	} );

	it( 'keeps a query-bearing entry URL and its default-document capture distinct when their content differs', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-default-document-query-distinct-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'homepage-index.html' ), '<h1>A different default document</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/?token=abc': { html: 'html/homepage.html' },
					'https://example.com/index.html': { html: 'html/homepage-index.html' },
				},
			} )
		);

		const receipt = JSON.parse( readFileSync( exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/?token=abc',
			platform: 'generic',
			summary: {},
			failures: [],
		} ), 'utf8' ) );

		expect( receipt.duplicateRoutes ).toEqual( [] );
		expect(
			Object.fromEntries( receipt.routes.map( ( route: { url: string; path: string } ) => [ route.url, route.path ] ) )
		).toEqual( {
			'https://example.com/?token=abc': 'website/index.html',
			'https://example.com/index.html': 'website/index-2.html',
		} );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( 'Home' );
		expect( readFileSync( join( outputDir, 'website', 'index-2.html' ), 'utf8' ) ).toContain(
			'A different default document'
		);
	} );

	it( 'rewrites a literal canonical link that names a captured route to its local path', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<link rel="canonical" href="https://example.com/"><h1>Home</h1><a href="https://example.com/about">About</a>'
		);
		writeFileSync(
			join( outputDir, 'html', 'about.html' ),
			'<link rel="canonical" href="https://example.com/about"><h1>About</h1>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about': { html: 'html/about.html' },
				},
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const homepage = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const about = readFileSync( join( outputDir, 'website', 'about', 'index.html' ), 'utf8' );
		expect( homepage ).toContain( 'rel="canonical" href="/index.html"' );
		expect( about ).toContain( 'rel="canonical" href="/about/index.html"' );
		expect( homepage ).not.toContain( 'example.com' );
		expect( about ).not.toContain( 'example.com' );
	} );

	it( 'fails when routes claim the same website path without declaring a canonical route', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
		writeFileSync( join( outputDir, 'html', 'about-slash.html' ), '<h1>About us</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/': { html: 'html/homepage.html' },
					'https://example.com/about': { html: 'html/about.html' },
					'https://example.com/about/': { html: 'html/about-slash.html' },
				},
			} )
		);

		expect( () =>
			exportWebsiteCapture( {
				outputDir,
				sourceUrl: 'https://example.com',
				platform: 'fake',
				summary: {},
				failures: [],
			} )
		).toThrow( 'Captured routes resolve to the same website path: about/index.html' );
	} );

	it( 'localizes external lazy, responsive, preload, icon, and recursive CSS render dependencies', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-portable-render-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'resources/cdn/css', 'resources/cdn/media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><link rel="canonical" href="https://example.com/canonical"><meta property="og:image" content="https://cdn.example/social.jpg"><link rel="icon" href="https://cdn.example/favicon.ico"><link rel="preload" as="font" href="https://cdn.example/font.woff2"><link rel="preload" as="image" href="https://cdn.example/preload.jpg"><link rel="stylesheet" href="https://cdn.example/site.css"><style>.missing{background:url("https://cdn.example/missing.jpg")}</style></head><body><img loading="lazy" src="https://cdn.example/lazy.jpg" srcset="https://cdn.example/lazy-1.jpg 1x, https://cdn.example/lazy-2.jpg 2x"><picture><source srcset="https://cdn.example/picture.jpg 1x"><img src="https://cdn.example/fallback.jpg"></picture></body></html>'
		);
		const resources: Record< string, { path: string; contentType: string } > = {};
		const add = ( url: string, path: string, contentType: string, content: string ) => {
			writeFileSync( join( outputDir, 'resources', path ), content );
			resources[ url ] = { path: `resources/${ path }`, contentType };
		};
		add(
			'https://cdn.example/site.css',
			'cdn/css/site.css',
			'@text/css'.slice( 1 ),
			'@import "nested.css";.hero{background:url("../media/background.jpg")}'
		);
		add(
			'https://cdn.example/nested.css',
			'cdn/css/nested.css',
			'text/css',
			'@font-face{src:url("../media/font.woff2")}'
		);
		for ( const [ name, type ] of [
			[ 'lazy.jpg', 'image/jpeg' ],
			[ 'lazy-1.jpg', 'image/jpeg' ],
			[ 'lazy-2.jpg', 'image/jpeg' ],
			[ 'picture.jpg', 'image/jpeg' ],
			[ 'fallback.jpg', 'image/jpeg' ],
			[ 'background.jpg', 'image/jpeg' ],
			[ 'favicon.ico', 'image/x-icon' ],
			[ 'font.woff2', 'font/woff2' ],
			[ 'preload.jpg', 'image/jpeg' ],
		] as const )
			add( `https://cdn.example/${ name }`, `cdn/media/${ name }`, type, name );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( { version: 1, resources, failures: [] } )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const css = readFileSync( join( outputDir, 'website', 'cdn', 'css', 'site.css' ), 'utf8' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( html ).toContain( 'href="https://example.com/canonical"' );
		expect( html ).toContain( 'content="https://cdn.example/social.jpg"' );
		expect( html ).not.toMatch(
			/https:\/\/cdn\.example\/(?:lazy|picture|fallback|favicon|font|preload|site|missing)/
		);
		expect( html ).toContain( 'about:blank' );
		expect( css ).not.toContain( 'https://cdn.example' );
		expect( diagnostics.unresolvedDependencies ).toContainEqual(
			expect.objectContaining( { url: 'https://cdn.example/missing.jpg' } )
		);
	} );

	it( 'omits failed @font-face src sentinels so captured woff and ttf can load', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-font-face-src-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'resources/css', 'resources/fonts' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const cssUrl = 'https://cdn.example/css/site.css';
		const eotUrl = 'https://cdn.example/fonts/icon.eot';
		const woffUrl = 'https://cdn.example/fonts/icon.woff';
		const ttfUrl = 'https://cdn.example/fonts/icon.ttf';
		const missingBackground = 'https://cdn.example/images/missing.jpg';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><head><link rel="stylesheet" href="${ cssUrl }"></head><body><span class="icon"></span></body></html>`
		);
		writeFileSync(
			join( outputDir, 'resources', 'css', 'site.css' ),
			`@font-face{font-family:"icon";src:url("${ eotUrl }");src:url("${ eotUrl }?#iefix") format("embedded-opentype"),url("${ woffUrl }") format("woff"),url("${ ttfUrl }") format("truetype")}.hero{background:url("${ missingBackground }")}`
		);
		writeFileSync( join( outputDir, 'resources', 'fonts', 'icon.woff' ), 'woff' );
		writeFileSync( join( outputDir, 'resources', 'fonts', 'icon.ttf' ), 'ttf' );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					[ cssUrl ]: { path: 'resources/css/site.css', contentType: 'text/css' },
					[ woffUrl ]: { path: 'resources/fonts/icon.woff', contentType: 'font/woff' },
					[ ttfUrl ]: { path: 'resources/fonts/icon.ttf', contentType: 'font/ttf' },
				},
				failures: [
					{
						url: eotUrl,
						error: 'render dependency has unsupported content type application/vnd.ms-fontobject',
					},
				],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const css = readFileSync( join( outputDir, 'website', 'css', 'site.css' ), 'utf8' );
		expect( css ).not.toMatch( /@font-face\{[^}]*data:application\/octet-stream;base64,/ );
		expect( css ).toContain( 'url("/fonts/icon.woff") format("woff")' );
		expect( css ).toContain( 'url("/fonts/icon.ttf") format("truetype")' );
		expect( css ).not.toContain( 'embedded-opentype' );
		expect( css ).not.toContain( '.eot' );
		expect( css ).toContain( '.hero{background:url("about:blank")}' );
		expect( readFileSync( join( outputDir, 'website', 'fonts', 'icon.woff' ), 'utf8' ) ).toBe( 'woff' );
		expect( readFileSync( join( outputDir, 'website', 'fonts', 'icon.ttf' ), 'utf8' ) ).toBe( 'ttf' );
	} );

	it( 'preserves downloaded backgrounds with HTML-escaped CDN queries in the portable page', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-css-media-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'html-mobile', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const sourceUrl = 'https://images.builderservices.io/s/cdn/v1.0/i/m?url=https%3A%2F%2Fstorage.googleapis.com%2Fproduction-ipower-v1-0-7%2F477%2F530477%2F36o4dN0U%2F7476a6728a1b4e788fcaf0dd3f1610a8&methods=resize%2C2000%2C5000';
		const mobileUrl = 'https://cdn.example/image?url=https%3A%2F%2Fimages.example%2Fphoto%2520one.jpg%3Fa%3D1%26b%3D2&width=600&format=webp';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><body>${ readFileSync( fileURLToPath( new URL( '../../test/fixtures/clearlake-css-background.html', import.meta.url ) ), 'utf8' ) }</body></html>`
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><main><div class="mobile-background" style="background-image:url(&quot;https://cdn.example/image?url=https%3A%2F%2Fimages.example%2Fphoto%2520one.jpg%3Fa%3D1%26b%3D2&amp;width=600&amp;format=webp&quot;)">Mobile</div><div class="missing-background" style="background:url(https://cdn.example/missing.jpg?width=600&amp;format=webp)">Missing</div></main></body></html>'
		);
		writeFileSync( join( outputDir, 'media', 'background.jpg' ), 'desktop-image' );
		writeFileSync( join( outputDir, 'media', 'background-mobile.webp' ), 'mobile-image' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( sourceUrl, join( outputDir, 'media', 'background.jpg' ) );
		media.markSuccess( mobileUrl, join( outputDir, 'media', 'background-mobile.webp' ) );
		media.save();
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( { version: 1, entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } } } )
		);

		const receiptPath = exportWebsiteCapture( {
			outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [],
		} );

		const $ = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		expect( $( '.kv-background-inner' ).attr( 'style' ) ).toContain( "background-image: url('/media/background.jpg')" );
		expect( $( '.kv-background-inner' ).attr( 'style' ) ).not.toContain( 'data:' );
		expect( $( '.mobile-background' ).attr( 'style' ) ).toBe( 'background-image:url("/media/background-mobile.webp")' );
		expect( $( '.missing-background' ).attr( 'style' ) ).toBe( 'background:url(about:blank)' );
		expect( readFileSync( join( outputDir, 'website', 'media', 'background.jpg' ), 'utf8' ) ).toBe( 'desktop-image' );
		expect( readFileSync( join( outputDir, 'website', 'media', 'background-mobile.webp' ), 'utf8' ) ).toBe( 'mobile-image' );
		expect( JSON.parse( readFileSync( receiptPath, 'utf8' ) ).assets ).toEqual( expect.arrayContaining( [
			{ sourceUrl, path: 'website/media/background.jpg' },
			{ sourceUrl: mobileUrl, path: 'website/media/background-mobile.webp' },
		] ) );
	} );

	it( 'localizes downloaded media and browser resources before hoisting shared CSS', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-shared-css-media-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media', 'resources/cdn' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const style = '<style>.hero{background:url("https://cdn.example/photo.jpg?width=600&format=webp")}.icon{background:url("https://cdn.example/icon.svg")}</style>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), `<html><head>${ style }</head><body><main class="hero">Home</main></body></html>` );
		writeFileSync( join( outputDir, 'html', 'about.html' ), `<html><head>${ style }</head><body><main class="hero">About</main></body></html>` );
		writeFileSync( join( outputDir, 'media', 'photo.webp' ), 'photo' );
		writeFileSync( join( outputDir, 'resources', 'cdn', 'icon.svg' ), '<svg></svg>' );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/photo.jpg?width=600&format=webp', join( outputDir, 'media', 'photo.webp' ) );
		media.save();
		writeFileSync( join( outputDir, 'resources', 'manifest.json' ), JSON.stringify( {
			version: 1, resources: { 'https://cdn.example/icon.svg': { path: 'resources/cdn/icon.svg', contentType: 'image/svg+xml' } }, failures: [],
		} ) );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'generic', summary: {}, failures: [] } );

		const homepage = cheerio.load( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) );
		const about = cheerio.load( readFileSync( join( outputDir, 'website', 'about', 'index.html' ), 'utf8' ) );
		const stylesheet = homepage( 'link[rel="stylesheet"]' ).attr( 'href' )!;
		expect( stylesheet ).toMatch( /^\/assets\/css\/capture-.*\.css$/ );
		expect( about( 'link[rel="stylesheet"]' ).attr( 'href' ) ).toBe( stylesheet );
		expect( readFileSync( join( outputDir, 'website', stylesheet ), 'utf8' ) ).toBe(
			'.hero{background:url("/media/photo.webp")}.icon{background:url("/cdn/icon.svg")}'
		);
	} );

	it.each( [
		{
			name: 'preserves a localized media URL inside a captured stylesheet',
			mediaStatus: 'success' as const,
			browserResource: true,
			expectedUrl: '/media/background.jpg',
		},
		{
			name: 'uses a captured browser image in CSS when the media download failed',
			mediaStatus: 'failure' as const,
			browserResource: true,
			expectedUrl: '/images/background.jpg',
		},
		{
			name: 'blanks CSS media when both download and browser capture failed',
			mediaStatus: 'failure' as const,
			browserResource: false,
			expectedUrl: 'about:blank',
		},
	] )( '$name', ( { mediaStatus, browserResource, expectedUrl } ) => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-stylesheet-media-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media', 'resources/css', 'resources/images' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const imageUrl = 'https://example.com/images/background.jpg';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<html><head><link rel="stylesheet" href="https://example.com/css/site.css"></head><body><img src="${ imageUrl }"><main class="hero">Home</main></body></html>`
		);
		writeFileSync(
			join( outputDir, 'resources', 'css', 'site.css' ),
			`.hero{background-image:url("${ imageUrl }")}`
		);
		if ( browserResource )
			writeFileSync( join( outputDir, 'resources', 'images', 'background.jpg' ), 'captured-image' );
		writeFileSync( join( outputDir, 'media', 'background.jpg' ), 'downloaded-image' );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					'https://example.com/css/site.css': {
						path: 'resources/css/site.css',
						contentType: 'text/css',
					},
					...( browserResource
						? {
								[ imageUrl ]: {
									path: 'resources/images/background.jpg',
									contentType: 'image/jpeg',
								},
						  }
						: {} ),
				},
				failures: [],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		if ( mediaStatus === 'success' )
			media.markSuccess( imageUrl, join( outputDir, 'media', 'background.jpg' ) );
		else media.markFailure( imageUrl, 'HTTP 403' );
		media.flush();

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'generic',
			summary: {},
			failures: [],
		} );

		expect( readFileSync( join( outputDir, 'website', 'css', 'site.css' ), 'utf8' ) ).toBe(
			`.hero{background-image:url("${ expectedUrl }")}`
		);
		if ( mediaStatus === 'success' ) {
			expect( readFileSync( join( outputDir, 'website', 'media', 'background.jpg' ), 'utf8' ) ).toBe(
				'downloaded-image'
			);
		}
	} );

	it( 'drops leftover remote asset requests while keeping editorial links', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-self-contain-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><head><link rel="canonical" href="https://example.com/"><link rel="preconnect" href="https://siteassets.example.com"><link rel="dns-prefetch" href="//cdn.example"><link rel="stylesheet" href="https://runtime.example/theme.css"><style>.x{background:url("https://runtime.example/bg.jpg")}</style></head><body><a href="https://external.example/about">About</a></body></html>'
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );
		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'siteassets.example.com' );
		expect( html ).not.toContain( 'runtime.example' );
		expect( html ).not.toContain( 'cdn.example' );
		expect( html ).not.toContain( 'example.com' );
		expect( html ).toContain( 'rel="canonical" href="/index.html"' );
		expect( html ).toContain( 'href="https://external.example/about"' );
	} );

	it( 'does not treat the source root as a global media replacement', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-root-media-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media', 'resources/cdn' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const sourceHtml = '<html><head><link rel="stylesheet" href="https://cdn.example/site.css"></head><body><img src="/"><p data-kind="image/x-icon">Icon</p><a href="/about/">About</a></body></html>';
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), sourceHtml );
		writeFileSync( join( outputDir, 'media', 'homepage.jpg' ), 'not-an-image' );
		writeFileSync(
			join( outputDir, 'resources', 'cdn', 'site.css' ),
			'.icon{background-image:url("data:image/svg+xml;base64,PHN2Zz4=")}'
		);
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					'https://cdn.example/site.css': {
						path: 'resources/cdn/site.css',
						contentType: 'text/css',
					},
				},
				failures: [],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://example.com/', join( outputDir, 'media', 'homepage.jpg' ) );
		media.flush();

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const css = readFileSync( join( outputDir, 'website', 'cdn', 'site.css' ), 'utf8' );
		expect( html ).toContain( 'data-kind="image/x-icon"' );
		expect( html ).toContain( 'href="https://example.com/about/"' );
		expect( html ).not.toContain( 'https:https://' );
		expect( css ).toContain( 'data:image/svg+xml;base64,PHN2Zz4=' );
	} );

	it( 'uses a captured browser image when the primary media download failed', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-browser-media-fallback-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'resources/external' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const source = 'https://cdn.example/icons/feature.png?resize=88%2C87';
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<main><img src="${ source }" width="41" height="87"></main>`
		);
		writeFileSync( join( outputDir, 'resources', 'external', 'feature.webp' ), 'webp' );
		writeFileSync(
			join( outputDir, 'resources', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				resources: {
					[ source ]: {
						path: 'resources/external/feature.webp',
						contentType: 'image/webp',
					},
				},
				failures: [],
			} )
		);
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markFailure( source, 'HTTP 403' );

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( 'src="/external/feature.webp"' );
		expect( html ).not.toContain( 'data:image/gif;base64,' );
		expect( readFileSync( join( outputDir, 'website', 'external', 'feature.webp' ), 'utf8' ) ).toBe(
			'webp'
		);
	} );

	it( 'keeps portable media within the artifact capacity left after routes and resources', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-budget-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const filler = 'x'.repeat( 300 * 1024 );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<main><h1>Home</h1><p>${ filler }</p><img src="https://cdn.example/first.png"><img src="https://cdn.example/second.png"></main>`
		);
		writeFileSync( join( outputDir, 'media', 'first.png' ), Buffer.alloc( 120 * 1024, 1 ) );
		writeFileSync( join( outputDir, 'media', 'second.png' ), Buffer.alloc( 120 * 1024, 2 ) );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/first.png', join( outputDir, 'media', 'first.png' ) );
		media.markSuccess( 'https://cdn.example/second.png', join( outputDir, 'media', 'second.png' ) );
		media.flush();

		const artifactTotalBytes = 500 * 1024;
		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			limits: { portableMediaTotalBytes: artifactTotalBytes },
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia ).toMatchObject( {
			selected_count: 2,
			retained_external_count: 0,
			max_bytes: artifactTotalBytes,
		} );
	} );

	it( 'keeps generated reports beside the portable website', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-report-budget-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			`<main>${ 'x'.repeat( 300 * 1024 ) }<img src="https://cdn.example/image.png"></main>`
		);
		writeFileSync( join( outputDir, 'media', 'image.png' ), Buffer.alloc( 170 * 1024, 1 ) );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: { 'https://example.com/': { html: 'html/homepage.html' } },
		} ) );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/image.png', join( outputDir, 'media', 'image.png' ) );
		media.flush();

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			limits: { portableMediaTotalBytes: 480 * 1024 },
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia.selected_count ).toBe( 1 );
		expect( existsSync( join( outputDir, 'diagnostics.json' ) ) ).toBe( true );
		expect( existsSync( join( outputDir, 'source-profile.json' ) ) ).toBe( true );
		expect( existsSync( join( outputDir, 'artifact.json' ) ) ).toBe( false );
	} );

	it( 'retains every route beyond a former compiler file boundary', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-file-boundary-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const entries: Record< string, { html: string } > = {};
		for ( let index = 0; index < 4_996; index++ ) {
			const slug = `page-${ index }`;
			writeFileSync( join( outputDir, 'html', `${ slug }.html` ), '<main>Page</main>' );
			entries[ index === 0 ? 'https://example.com/' : `https://example.com/${ slug }` ] = {
				html: `html/${ slug }.html`,
			};
		}
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( { version: 1, entries } ) );

		exportWebsiteCapture( { outputDir, sourceUrl: 'https://example.com/', platform: 'fake', summary: {}, failures: [] } );

		const receipt = JSON.parse( readFileSync( join( outputDir, 'capture-receipt.json' ), 'utf8' ) );
		expect( receipt.routes ).toHaveLength( 4_996 );
		expect( existsSync( join( outputDir, 'website', 'page-4995', 'index.html' ) ) ).toBe( true );
	}, 60_000 );

	it( 'reserves repeated hoisted stylesheets before allocating constrained artifact media', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-style-budget-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		const sharedCss = `.shared{content:"${ 'x'.repeat( 80 * 1024 ) }"}`;
		for ( const slug of [ 'homepage', 'about' ] )
			writeFileSync(
				join( outputDir, 'html', `${ slug }.html` ),
				`<html><head><style>${ sharedCss }</style></head><body><p>${ 'x'.repeat( 50 * 1024 ) }</p><img src="https://cdn.example/image.png"></body></html>`
			);
		writeFileSync( join( outputDir, 'media', 'image.png' ), Buffer.alloc( 100 * 1024, 1 ) );
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/image.png', join( outputDir, 'media', 'image.png' ) );
		media.flush();

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			limits: { portableMediaTotalBytes: 400 * 1024 },
		} );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia.selected_count ).toBe( 1 );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( '/assets/css/capture-' );
	} );

	it( 'hoists repeated 80 KiB safe styles without an artifact budget', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-net-style-budget-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const sharedCss = `.shared{content:"${ 'x'.repeat( 80 * 1024 ) }"}`;
		for ( const slug of [ 'homepage', 'about' ] )
			writeFileSync(
				join( outputDir, 'html', `${ slug }.html` ),
				`<html><head><style>${ sharedCss }</style></head><body><p>Page</p></body></html>`
			);
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1,
			entries: {
				'https://example.com/': { html: 'html/homepage.html' },
				'https://example.com/about': { html: 'html/about.html' },
			},
		} ) );

		const limit = 170 * 1024;
		const oldInflatedBytes =
			Buffer.byteLength( readFileSync( join( outputDir, 'html', 'homepage.html' ), 'utf8' ) ) * 2 +
			Buffer.byteLength( sharedCss );
		expect( oldInflatedBytes ).toBeGreaterThan( limit );
		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			limits: { portableMediaTotalBytes: limit },
		} );

		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain( '/assets/css/capture-' );
	} );

	it( 'retains routes when capture reports exceed a former compiler cap', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-report-preflight-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots' ] ) mkdirSync( join( outputDir, path ), { recursive: true } );
		const entries: Record< string, { html: string } > = {};
		for ( let index = 0; index < 100; index++ ) {
			const slug = `page-${ index }`;
			writeFileSync( join( outputDir, 'html', `${ slug }.html` ), '<main>Page</main>' );
			entries[ index === 0 ? 'https://example.com/' : `https://example.com/${ slug }` ] = {
				html: `html/${ slug }.html`,
			};
		}
		writeFileSync( join( outputDir, 'screenshots', 'manifest.json' ), JSON.stringify( { version: 1, entries } ) );

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
			limits: { portableMediaTotalBytes: 3 * 1024 },
		} );
		expect( existsSync( join( outputDir, 'website', 'page-99', 'index.html' ) ) ).toBe( true );
		expect( existsSync( join( outputDir, 'artifact.json' ) ) ).toBe( false );
	} );

	it( 'does not treat empty img src as page-URL media or rewrite every slash', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-empty-src-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><body><div class="hero"><p>Home</p><img alt="Wix placeholder" src=""><img src="https://cdn.example/logo.png"></div></body></html>'
		);
		writeFileSync(
			join( outputDir, 'media', 'image-1788009152544.jpg' ),
			Buffer.alloc( 6 * 1024 * 1024, 1 )
		);
		writeFileSync( join( outputDir, 'media', 'logo.png' ), 'png' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess(
			'https://example.com/',
			join( outputDir, 'media', 'image-1788009152544.jpg' )
		);
		media.markSuccess( 'https://cdn.example/logo.png', join( outputDir, 'media', 'logo.png' ) );
		media.flush();

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		expect( html ).toContain( '</div>' );
		expect( html ).toContain( '</p>' );
		expect( html ).not.toContain( '<https://example.com/div>' );
		expect( html ).not.toContain( '<https://example.com/p>' );
		expect( html ).toContain( '/media/logo.png' );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.assets.map( ( asset: { sourceUrl: string } ) => asset.sourceUrl ) ).toEqual( [
			'https://cdn.example/logo.png',
		] );
		expect( existsSync( join( outputDir, 'website', 'media', 'image-1788009152544.jpg' ) ) ).toBe(
			false
		);
	} );

	it( 'preserves document syntax when a replacement map includes a bare slash', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-degenerate-slash-export-' ) );
		dirs.push( outputDir );
		for ( const path of [ 'html', 'screenshots', 'media' ] )
			mkdirSync( join( outputDir, path ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<html><body><div class="hero-wrap"><div class="hero-inner"><img src="/hero.png"><img src="https://cdn.example/logo.png"></div></div><style>.hero-inner{background-image:url(/)}</style></body></html>'
		);
		writeFileSync( join( outputDir, 'media', 'hero.png' ), 'hero' );
		writeFileSync( join( outputDir, 'media', 'logo.png' ), 'logo' );
		writeFileSync( join( outputDir, 'media', 'root.png' ), 'root' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { html: 'html/homepage.html' } },
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://example.com/', join( outputDir, 'media', 'root.png' ) );
		media.markSuccess( 'https://example.com/hero.png', join( outputDir, 'media', 'hero.png' ) );
		media.markSuccess( 'https://cdn.example/logo.png', join( outputDir, 'media', 'logo.png' ) );
		media.flush();

		exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const html = readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( html ).toContain( '</div>' );
		expect( html ).not.toMatch( /<\/(?:https?:|media\/)/ );
		expect( html ).not.toContain( '<https://' );
		expect( html ).toContain( '/media/hero.png' );
		expect( html ).toContain( '/media/logo.png' );
		expect( diagnostics.unresolvedMedia ).toContainEqual( {
			url: '/',
			error: 'skipped degenerate replacement key',
		} );
	} );
} );
