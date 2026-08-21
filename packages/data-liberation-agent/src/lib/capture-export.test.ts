import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CAPTURE_RECEIPT_SCHEMA,
	exportWebsiteCapture,
	WEBSITE_ARTIFACT_SCHEMA,
} from './capture-export.js';
import { MediaStubStore } from './resume-state/index.js';

const dirs: string[] = [];

afterEach( () => {
	for ( const dir of dirs.splice( 0 ) ) rmSync( dir, { recursive: true, force: true } );
} );

describe( 'exportWebsiteCapture', () => {
	it( 'exports captured routes and localized media as a website directory', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		mkdirSync( join( outputDir, 'media' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head><style>.desktop{color:blue}</style></head><body><a href="https://example.com/shop/about?from=home#team">About</a><a href="https://example.com/shop/missing">Missing</a><a href="https://external.example/about">External</a><img src="https://cdn.example/logo.png"><img src="https://cdn.example/avatar.png&amp;quot;"><img src="/hero.png?w=128" srcset="/hero.png?w=128 128w, /hero.png?w=4096 4096w"><img src="https://static.wixstatic.com/media/hash~mv2.jpg" srcset="https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_567,h_740,q_90,enc_avif,quality_auto/hash~mv2.jpg 1x, https://static.wixstatic.com/media/hash~mv2.jpg/v1/fill/w_1034,h_1349,q_90,enc_avif,quality_auto/hash~mv2.jpg 2x"><h1>Home</h1><p>$100.00</p><noscript><main>This site requires JavaScript</main></noscript></body></html>'
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
					'https://example.com/shop/': { html: 'html/homepage.html' },
					'https://example.com/shop/about': { html: 'html/about.html' },
					'https://example.com/': { html: 'html/corporate.html' },
				},
			} )
		);
		const media = MediaStubStore.load( outputDir );
		media.markSuccess( 'https://cdn.example/logo.png', join( outputDir, 'media', 'logo.png' ) );
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
			) }<img src="/only-huge.png"><img src="https://cdn.example/images/asset.jpg/v1/fit/w_3939,h_3939/source.jpg/v1/fit/w_554,h_597/rendered.jpg"><script src="/uncaptured.js"></script   ><div style="background-image:image-set(url('/missing.png?w=1280') 1x)"></div>`
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
			'/media/localized.jpg'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'This site requires JavaScript'
		);
		expect( readFileSync( join( outputDir, 'website', 'index.html' ), 'utf8' ) ).not.toContain(
			'uncaptured.js'
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
			error: 'retained as an external URL because media exceeds portable size or dimension limits',
		} );
	} );

	it( 'keeps one authoring body when responsive captures differ only in presentation', () => {
		const outputDir = mkdtempSync( join( tmpdir(), 'dla-capture-export-' ) );
		dirs.push( outputDir );
		mkdirSync( join( outputDir, 'html' ), { recursive: true } );
		mkdirSync( join( outputDir, 'html-mobile' ), { recursive: true } );
		mkdirSync( join( outputDir, 'screenshots' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<!doctype html><html><head></head><body><main class="desktop" style="width:900px"><img src="/hero-large.jpg"><h1>Home</h1></main></body></html>'
		);
		writeFileSync(
			join( outputDir, 'html-mobile', 'homepage.html' ),
			'<!doctype html><html><head></head><body><main class="mobile" style="width:390px"><img src="/hero-small.jpg"><h1>Home</h1><div class="runtime-mount"></div></main></body></html>'
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
		expect( html ).toContain( 'function resolve(e){return url(e)}' );
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
		mkdirSync( join( outputDir, 'resources', 'assets', 'css' ), { recursive: true } );
		mkdirSync( join( outputDir, 'resources', 'assets', 'images' ), { recursive: true } );
		writeFileSync(
			join( outputDir, 'html', 'homepage.html' ),
			'<img src="https://example.com/hero.png"><img src="/assets/images/mobile-only.webp" srcset="/assets/images/mobile-only.webp 390w"><link rel="stylesheet" href="/assets/css/site.css"><link rel="preload" href="/_runtimes/site.js" as="script"><link rel="preload" href="/_json/site.json" as="fetch"><link rel="preload" href="/_json/missing.json" as="fetch"><style>@font-face{src:url("/_fonts/site.woff2")}@font-face{src:url("/_fonts/missing.woff2")}.hero{background:url(&quot;/assets/images/missing-background.webp&quot;)}</style><video><source src="/_videos/hero"></video><video><source src="/_videos/missing"></video><script src="/_runtimes/site.js" defer></script><script src="/_runtimes/missing-script.js" defer></script><script type="module">import { Site } from "/_runtimes/site.js"; import "/_runtimes/missing.js";</script>'
		);
		writeFileSync( join( outputDir, 'media', 'hero.png' ), 'png' );
		writeFileSync( join( outputDir, 'resources', '_runtimes', 'site.js' ), 'export class Site {}' );
		writeFileSync(
			join( outputDir, 'resources', '_json', 'site.json' ),
			'{"image":"https://example.com/hero.png"}'
		);
		writeFileSync( join( outputDir, 'resources', '_fonts', 'site.woff2' ), 'font' );
		writeFileSync( join( outputDir, 'resources', '_videos', 'hero.mp4' ), 'video' );
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

		const receiptPath = exportWebsiteCapture( {
			outputDir,
			sourceUrl: 'https://example.com/',
			platform: 'fake',
			summary: {},
			failures: [],
		} );

		const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) );
		const diagnostics = JSON.parse( readFileSync( join( outputDir, 'diagnostics.json' ), 'utf8' ) );
		expect( receipt.assets ).toContainEqual( {
			sourceUrl: 'https://example.com/_runtimes/site.js',
			path: 'website/_runtimes/site.js',
		} );
		expect( readFileSync( join( outputDir, 'website', '_runtimes', 'site.js' ), 'utf8' ) ).toBe(
			'export class Site {}'
		);
		expect( receipt.assets ).toContainEqual( {
			sourceUrl: 'https://example.com/_json/site.json',
			path: 'website/_json/site.json',
		} );
		expect( readFileSync( join( outputDir, 'website', '_json', 'site.json' ), 'utf8' ) ).toBe(
			'{"image":"/media/hero.png"}'
		);
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
				expect.objectContaining( { url: 'https://example.com/_json/missing.json' } ),
				expect.objectContaining( { url: 'https://example.com/_runtimes/missing.js' } ),
				expect.objectContaining( {
					url: 'https://example.com/_runtimes/missing-script.js',
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
		expect( html ).toContain( 'import "/_runtimes/missing.js"' );
		expect( html ).toContain( '<script src="/_runtimes/site.js"' );
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
		writeFileSync( join( outputDir, 'html', 'homepage.html' ), '<h1>Home</h1>' );
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
		writeFileSync( join( outputDir, 'html', 'home.html' ), '<h1>Canonical home</h1>' );
		writeFileSync( join( outputDir, 'html', 'about.html' ), '<h1>About</h1>' );
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
			'<html><head><meta property="og:url" content="https://example.com"></head><body><h1>Canonical home</h1></body></html>'
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
} );
