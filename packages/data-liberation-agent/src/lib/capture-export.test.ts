import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CAPTURED_INTERACTIONS_SCHEMA,
	CAPTURE_RECEIPT_SCHEMA,
	exportWebsiteCapture,
	portableInlineStyle,
	WEBSITE_ARTIFACT_SCHEMA,
} from './capture-export.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';

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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const publication = artifact.files.find(
			( file: { path: string } ) =>
				file.path ===
				'website/post/can-chiropractic-help-with-back-pain-360-chiro-clinic-sheffield/index.html'
		);
		const $ = cheerio.load( publication.content );
		const jsonLd = $( 'head script[type="application/ld+json"]' );
		expect( jsonLd ).toHaveLength( 1 );
		expect( JSON.parse( jsonLd.text() ) ).toMatchObject( {
			'@context': 'https://schema.org',
			'@type': 'BlogPosting',
			datePublished: '2026-08-24T12:49:28.000Z',
		} );
		expect( publication.metadata ).toBeUndefined();
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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const page = artifact.files.find( ( file: { path: string } ) => file.path === 'website/index.html' );
		expect( page.content ).toContain( 'application/ld+json' );
		const $ = cheerio.load( page.content );
		const jsonLd = $( 'script[type="application/ld+json"]' );
		expect( jsonLd ).toHaveLength( 2 );
		expect( JSON.parse( jsonLd.first().text() ) ).toMatchObject( {
			'@type': 'Article', datePublished: '2025-01-02T03:04:05Z',
		} );
		expect( JSON.parse( jsonLd.last().text() ) ).toMatchObject( {
			'@type': 'WebPage', mainEntity: { '@type': 'Article', datePublished: '2024-05-06T07:08:09Z' },
		} );
		expect( page.content ).toContain( '<\\/script>' );
		expect( page.content ).not.toContain( '<script>globalThis.executed = true</script>' );
		expect( page.content ).not.toContain( 'source-only-primitive' );
		expect( page.metadata ).toBeUndefined();
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
	it( 'carries bounded responsive section evidence in the portable artifact', () => {
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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const evidence = JSON.parse(
			readFileSync( join( outputDir, 'semantic-evidence.json' ), 'utf8' )
		);
		expect( artifact.semantic_evidence ).toMatchObject( {
			path: 'semantic-evidence.json',
			page_count: 1,
		} );
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
		const artifactEvidence = artifact.files.find(
			( file: { path: string } ) => file.path === 'semantic-evidence.json'
		);
		expect( Buffer.byteLength( artifactEvidence.content ) ).toBeLessThanOrEqual(
			artifact.compiler_limits.max_file_bytes
		);
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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.semantic_evidence ).toBeUndefined();
		expect( artifact.files.map( ( file: { path: string } ) => file.path ) ).not.toContain(
			'semantic-evidence.json'
		);
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
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.layout_geometry_proof ).toMatchObject( {
			schema: 'blocks-engine/php-transformer/layout-geometry-proof/v1',
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
			'<html><body><a href="https://example.com/#features" data-dla-anchor-fragment="features">Features</a><a href="https://example.com/#missing" data-dla-anchor-fragment="missing" data-dla-anchor-unresolved="runtime scroll did not resolve to a section boundary">Missing</a><span id="features" data-dla-anchor-target="features"></span><section>Desktop features</section></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><body><a href="https://example.com/#features" data-dla-anchor-fragment="features">Features</a><span id="features" data-dla-anchor-target="features"></span><section>Mobile features</section></body></html>'
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
			'<html><head><style>.mobile{color:red}:root .device-mobile-responsive.responsive{display:revert!important}</style></head><body class="device-mobile-responsive responsive"><main>Mobile</main></body></html>'
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
			'<html><head><style>.mobile{color:red}</style></head><body><main>Mobile</main></body></html>'
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
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
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
		expect( artifact.layout_geometry_proof.reductions ).toHaveLength( 2 );
		expect( artifact.layout_geometry_proof.nodes ).toEqual(
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
		const geometryArtifact = JSON.parse(
			readFileSync( join( outputDir, 'artifact.json' ), 'utf8' )
		);
		expect( geometryArtifact.reports ).toContain( 'layout-geometry-report.json' );
		expect(
			JSON.parse( readFileSync( join( outputDir, 'layout-geometry-report.json' ), 'utf8' ) )
		).toMatchObject( {
			schema: 'blocks-engine/php-transformer/layout-geometry-proof/v1',
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
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.reports ).toContain( 'interaction-states.json' );
		const interactionReport = JSON.parse(
			artifact.files.find( ( file: { path: string } ) => file.path === 'interaction-states.json' )
				.content
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
		expect( artifact ).toMatchObject( {
			schema: WEBSITE_ARTIFACT_SCHEMA,
			artifact_type: 'website',
			compiler_limits: {
				max_files: 5000,
				max_file_bytes: 10 * 1024 * 1024,
				max_total_bytes: 192 * 1024 * 1024,
			},
			root: 'website',
			entrypoint: 'website/index.html',
			provenance: {
				provider: 'data-liberation/browser-capture',
				source_url: 'https://example.com/shop/',
			},
		} );
		expect( artifact.files[ 0 ].path ).toBe( 'website/index.html' );
		expect(
			artifact.files.filter( ( file: { path: string } ) => file.path === 'website/media/logo.png' )
		).toHaveLength( 1 );
		expect( artifact.files ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( { path: 'website/index.html', encoding: 'utf8' } ),
				expect.objectContaining( {
					path: 'website/media/logo.png',
					encoding: 'base64',
					content_base64: Buffer.from( 'png' ).toString( 'base64' ),
				} ),
			] )
		);
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
			`import { existsSync, readFileSync, statSync } from 'node:fs';
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
const artifactPath = ${ JSON.stringify( join( outputDir, 'artifact.json' ) ) };
if ( !existsSync( artifactPath ) || statSync( artifactPath ).size === 0 )
	throw new Error( 'artifact was not completed' );
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

	it( 'compacts structured semantic evidence to fit the artifact file limit', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-compact-semantic-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<main><h1>Home</h1></main>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: { 'https://example.com/': { slug: 'homepage', html: 'html/homepage.html' } },
			} )
		);
		const spec = {
			selector: 'main > section',
			layout: { samples: Array.from( { length: 56_000 }, () => 0 ) },
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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const evidence = JSON.parse(
			readFileSync( join( outputDir, 'semantic-evidence.json' ), 'utf8' )
		);
		expect( Buffer.byteLength( JSON.stringify( evidence, null, 2 ) ) ).toBeGreaterThan(
			artifact.compiler_limits.max_file_bytes
		);
		const artifactEvidence = artifact.files.find(
			( file: { path: string } ) => file.path === 'semantic-evidence.json'
		);
		expect( Buffer.byteLength( artifactEvidence.content ) ).toBeLessThanOrEqual(
			artifact.compiler_limits.max_file_bytes
		);
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
			'<html><body><main><h1>Mobile capture</h1></main></body></html>'
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
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const stylesheets = artifact.files.filter( ( file: { path: string } ) =>
			/^website\/assets\/css\/capture-[a-f0-9]{64}\.css$/.test( file.path )
		);
		expect(
			stylesheets.map( ( file: { content_base64: string } ) =>
				Buffer.from( file.content_base64, 'base64' ).toString( 'utf8' )
			)
		).toContain( '.layout{display:grid}@media(max-width:600px){.layout{display:block}}' );
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
		const stylesheets = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) ).files.filter(
			( file: { path: string } ) => /^website\/assets\/css\/capture-[a-f0-9]{64}\.css$/.test( file.path )
		);
		expect( stylesheets ).toHaveLength( 1 );
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
		expect( JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) ).reports ).toContain( 'diagnostics.json' );
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
		expect( html.match( /href="\/work"/g ) ).toHaveLength( 1 );
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
			'.hero{background:url("/assets/images/hero.webp")}.missing{background:url("data:application/octet-stream;base64,")}'
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
		expect( html ).not.toContain( '/assets/images/missing-background.webp' );
		expect( html ).toContain( '<source src="/_videos/hero.mp4">' );
		expect( readFileSync( join( outputDir, 'website', '_videos', 'hero.mp4' ), 'utf8' ) ).toBe(
			'video'
		);
		expect( html ).toContain( '<source>' );
		expect( html ).not.toContain( '/_videos/missing' );
		expect( html ).not.toContain( '/_fonts/missing.woff2' );
		expect( html ).toContain( 'data:application/octet-stream;base64,' );
		expect( html ).not.toContain( '/_runtimes/site.js' );
		expect( html ).not.toContain( '/_runtimes/missing-script.js' );
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.files ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( { path: 'diagnostics.json', encoding: 'utf8' } ),
				expect.objectContaining( { path: 'capture-receipt.json', encoding: 'utf8' } ),
			] )
		);
	} );

	it( 'rejects decoded route paths that escape the website directory', () => {
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
		expect( html ).toContain( 'data:application/octet-stream;base64,' );
		expect( css ).not.toContain( 'https://cdn.example' );
		expect( diagnostics.unresolvedDependencies ).toContainEqual(
			expect.objectContaining( { url: 'https://cdn.example/missing.jpg' } )
		);
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
		expect( html ).toContain( 'href="https://example.com/"' );
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
		expect( html ).toContain( 'href="/about/"' );
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
			limits: { artifactTotalBytes },
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia ).toMatchObject( {
			selected_count: 1,
			retained_external_count: 1,
		} );
		expect( receipt.portableMedia.max_bytes ).toBeLessThanOrEqual(
			artifactTotalBytes - 300 * 1024
		);
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.compiler_limits.max_total_bytes ).toBe( artifactTotalBytes );
		const totalBytes = artifact.files.reduce(
			( total: number, file: { content?: string; content_base64?: string } ) =>
				total +
				( file.content_base64 !== undefined
					? Buffer.from( file.content_base64, 'base64' ).length
					: Buffer.byteLength( file.content ?? '' ) ),
			0
		);
		expect( totalBytes ).toBeLessThanOrEqual( artifactTotalBytes );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( diagnostics.unresolvedMedia ).toContainEqual( {
			url: 'https://cdn.example/second.png',
			error: 'removed because the aggregate portable media limit was reached',
		} );
	} );

	it( 'uses exact generated report bytes before writing the artifact', () => {
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
			limits: { artifactTotalBytes: 480 * 1024 },
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia.selected_count ).toBe( 1 );
		expect( existsSync( join( outputDir, 'diagnostics.json' ) ) ).toBe( true );
		expect( existsSync( join( outputDir, 'source-profile.json' ) ) ).toBe( true );
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const totalBytes = artifact.files.reduce(
			( total: number, file: { content?: string; content_base64?: string } ) =>
				total +
				( file.content_base64 !== undefined
					? Buffer.from( file.content_base64, 'base64' ).length
					: Buffer.byteLength( file.content ?? '' ) ),
			0
		);
		expect( totalBytes ).toBeLessThanOrEqual( 480 * 1024 );
	} );

	it( 'exports exactly at the 5000-file boundary after reserving generated reports', () => {
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

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.files ).toHaveLength( 5_000 );
		expect( artifact.files.filter( ( file: { path: string } ) => file.path === 'diagnostics.json' ) ).toHaveLength( 1 );
		expect( artifact.files.filter( ( file: { path: string } ) => file.path === 'source-profile.json' ) ).toHaveLength( 1 );
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
			limits: { artifactTotalBytes: 400 * 1024 },
		} );
		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		expect( receipt.portableMedia.selected_count ).toBe( 1 );
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.files.some( ( file: { path: string } ) => /assets\/css\/capture-/.test( file.path ) ) ).toBe( true );
		const totalBytes = artifact.files.reduce(
			( total: number, file: { content?: string; content_base64?: string } ) =>
				total + ( file.content_base64 ? Buffer.from( file.content_base64, 'base64' ).length : Buffer.byteLength( file.content ?? '' ) ),
			0
		);
		expect( totalBytes ).toBeLessThanOrEqual( 400 * 1024 );
	} );

	it( 'hoists repeated 80 KiB safe styles when the net artifact fits below the old inflated estimate', () => {
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
			limits: { artifactTotalBytes: limit },
		} );

		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		expect( artifact.files.some( ( file: { path: string } ) => /assets\/css\/capture-/.test( file.path ) ) ).toBe( true );
		const artifactBytes = artifact.files.reduce(
			( total: number, file: { content?: string; content_base64?: string } ) =>
				total +
				( file.content_base64
					? Buffer.from( file.content_base64, 'base64' ).length
					: Buffer.byteLength( file.content ?? '' ) ),
			0
		);
		expect( artifactBytes ).toBeLessThan( limit );
	} );

	it( 'fails before artifact writing when dynamic report arrays exceed a tight total cap', () => {
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

		expect( () =>
			exportWebsiteCapture( {
				outputDir,
				sourceUrl: 'https://example.com/',
				platform: 'fake',
				summary: {},
				failures: [],
				limits: { artifactTotalBytes: 3 * 1024 },
			} )
		).toThrow( /before artifact writing/ );
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
