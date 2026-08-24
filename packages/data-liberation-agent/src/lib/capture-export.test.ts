import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
	it( 'carries valid responsive section evidence in the portable artifact', () => {
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
		} as never;
		SectionSpecsStore.load( outputDir ).set( 'https://example.com/', [ spec ], [] );
		SectionSpecsStore.loadMobile( outputDir ).set( 'https://example.com/', [ spec ], [] );

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
		expect( evidence.pages[ 0 ] ).toMatchObject( {
			path: 'website/index.html',
			viewports: {
				desktop: [ { headings: [ 'Tianna Wolfson' ] } ],
				mobile: [ { headings: [ 'Tianna Wolfson' ] } ],
			},
		} );
		expect( artifact.files.map( ( file: { path: string } ) => file.path ) ).toContain(
			'semantic-evidence.json'
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
			'<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><link rel="stylesheet" href="https://cdn.example/site.css"><style>.desktop{display:block}</style></head><body class="desktop-body" style="margin:3px;padding:4px"><main><div data-dla-geometry-id="desktop-wrapper-0" onclick="discard()"><section data-dla-geometry-id="desktop-target-0">Desktop<a href="javascript:discard()">Unsafe</a><form action="https://evil.example/"><button formaction="javascript:discard()">Send</button></form><iframe src="https://evil.example/"></iframe></section></div><script>discard()</script></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<html><head><style>.mobile{display:block}</style></head><body class="mobile-body" style="margin:5px;padding:6px"><main><div data-dla-geometry-id="mobile-wrapper-0"><section data-dla-geometry-id="mobile-target-0">Mobile</section></div></main></body></html>'
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
		expect( html ).toContain(
			'class="data-liberation-desktop-document desktop-body" style="margin:3px;padding:4px"'
		);
		expect( html ).toContain(
			'class="data-liberation-mobile-document mobile-body" style="margin:5px;padding:6px"'
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

	it( 'rejects unsafe shared-style media attributes', () => {
		expect( portableInlineStyle( ' media="screen & <style"', '.unsafe{}' ) ).toBeUndefined();
		expect( portableInlineStyle( ' media="screen and (min-width: 1px)"', '.safe{}' ) ).toEqual( {
			key: 'screen and (min-width: 1px)\n.safe{}',
			media: 'screen and (min-width: 1px)',
		} );
	} );

	it( 'exports captured routes and localized media as a website directory', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><style>.desktop{color:blue}</style></head><body><a href="https://example.com/shop/about?from=home#team">About</a><a href="https://example.com/shop/missing">Missing</a><a href="https://external.example/about">External</a><img src="https://cdn.example/logo.png"><img src="https://cdn.example/logo-copy.png"><img src="https://cdn.example/avatar.png&amp;quot;"><img src="/hero.png?w=128" srcset="/hero.png?w=128 128w, /hero.png?w=4096 4096w"><img src="https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_1034,h_1349,al_b,q_90/hash~mv2.jpg" srcset="https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_567,h_740,al_b,q_90,enc_avif,quality_auto/hash~mv2.jpg 1x, https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_1034,h_1349,al_b,q_90,enc_avif,quality_auto/hash~mv2.jpg 2x"><h1>Home</h1><p>$100.00</p><noscript><main>This site requires JavaScript</main></noscript></body></html>'
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
							schema: 'data-liberation/interaction-states/v1',
							sourceUrl: 'https://example.com/shop/',
							viewport: { width: 1440, height: 900 },
							capturedAt: '2026-08-22T00:00:00.000Z',
							states: [
								{
									status: 'captured',
									trigger: {
										selector: '#contact',
										tag: 'button',
										ariaHaspopup: 'dialog',
										dataBindings: { 'data-modalid': 'contact' },
									},
									dialog: {
										selector: '#contact-dialog',
										tag: 'div',
										id: 'contact-dialog',
										role: 'dialog',
										ariaModal: true,
										html: '<div id="contact-dialog" role="dialog"><form><input name="email"></form></div>',
										htmlBytes: 83,
										htmlTruncated: false,
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
					sourceUrl: 'https://static.wixstatic.com/media/hash~mv2.jpg',
					path: 'website/media/wix.jpg',
				},
				{
					sourceUrl:
						'https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_704,h_853/rendered.jpg',
					path: 'website/media/localized.jpg',
				},
			],
			excludedRoutes: [ 'https://example.com/' ],
		} );
		expect( receipt.interactions ).toEqual( {
			candidate_count: 1,
			captured_count: 1,
			no_dialog_count: 0,
			click_failed_count: 0,
			truncated_count: 0,
		} );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'/media/logo.png'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'/media/hero-2.png'
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
			'href="/about/index.html?from=home#team"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="https://example.com/shop/missing"'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'href="https://external.example/about"'
		);
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
			totals: { candidate_count: 1, captured_count: 1 },
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
		const routeCount = 40;
		const content = 'x'.repeat( 512 * 1024 );
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
			[ '--max-old-space-size=384', '--import', 'tsx', runnerPath ],
			{ cwd: process.cwd(), encoding: 'utf8', timeout: 90_000 }
		);

		expect( result.error ).toBeUndefined();
		expect( result.status, result.stderr ).toBe( 0 );
	}, 100_000 );

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
		expect( html.match( /capture-[a-f0-9]{16}\.css/g ) ).toHaveLength( 2 );
		expect( html ).toContain( 'media="screen and (min-width: 1px)"' );
		expect( html ).not.toContain( ':where(.data-liberation-mobile-document) .layout' );
		const artifact = JSON.parse( readFileSync( join( outputDir, 'artifact.json' ), 'utf8' ) );
		const stylesheets = artifact.files.filter( ( file: { path: string } ) =>
			/^website\/assets\/css\/capture-[a-f0-9]{16}\.css$/.test( file.path )
		);
		expect(
			stylesheets.map( ( file: { content_base64: string } ) =>
				Buffer.from( file.content_base64, 'base64' ).toString( 'utf8' )
			)
		).toContain( '.layout{display:grid}@media(max-width:600px){.layout{display:block}}' );
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
			'<h1>Canonical home</h1><a href="/about">About</a>'
		);
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
		writeFileSync( join( outputDir, 'html', 'orphan.html' ), '<h1>Unlinked draft</h1>' );
		writeFileSync(
			join( outputDir, 'screenshots', 'manifest.json' ),
			JSON.stringify( {
				version: 1,
				entries: {
					'https://example.com/home': {
						html: 'html/home.html',
						metadata: { openGraph: { 'og:url': 'https://example.com' } },
					},
					'https://example.com/about': { html: 'html/about.html' },
					'https://example.com/orphan': { html: 'html/orphan.html' },
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
			{ url: 'https://example.com/home', path: 'website/index.html' },
			{ url: 'https://example.com/about', path: 'website/about/index.html' },
		] );
		expect( receipt.excludedRoutes ).toContain( 'https://example.com/orphan' );
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).toContain(
			'Canonical home'
		);
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
} );
