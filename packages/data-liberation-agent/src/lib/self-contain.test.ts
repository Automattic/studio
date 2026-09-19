import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	isRemoteAssetUrl,
	selfContainWebsite,
	stripRemoteAssetRequests,
	stripRemoteCssUrls,
} from './self-contain.js';

describe( 'self-contain', () => {
	it( 'treats absolute and protocol-relative hosts as remote, local paths as not', () => {
		expect( isRemoteAssetUrl( 'https://siteassets.example.com/app.js' ) ).toBe( true );
		expect( isRemoteAssetUrl( '//cdn.example/font.woff2' ) ).toBe( true );
		expect( isRemoteAssetUrl( '/media/hero.png' ) ).toBe( false );
		expect( isRemoteAssetUrl( 'assets/site.css' ) ).toBe( false );
		expect( isRemoteAssetUrl( 'data:image/gif;base64,xx' ) ).toBe( false );
	} );

	it( 'drops leftover remote asset requests and keeps editorial links', () => {
		const html = stripRemoteAssetRequests(
			[
				'<html><head>',
				'<link rel="canonical" href="https://example.com/">',
				'<link rel="preconnect" href="https://siteassets.example.com">',
				'<link rel="dns-prefetch" href="//cdn.example">',
				'<link rel="preload" as="script" href="https://cdn.example/app.js">',
				'<link rel="stylesheet" href="https://uncaptured.example/theme.css">',
				'<link rel="stylesheet" href="/assets/css/site.css">',
				'<style>.x{background:url("//cdn.example/bg.jpg")}</style>',
				'</head><body>',
				'<a href="https://external.example/about">About</a>',
				'<img src="https://cdn.example/hero.jpg">',
				'<img src="/media/kept.png" srcset="https://cdn.example/wide.jpg 1600w, /media/kept.png 800w">',
				'</body></html>',
			].join( '' )
		);
		expect( html ).not.toContain( 'siteassets.example.com' );
		expect( html ).not.toContain( 'uncaptured.example' );
		expect( html ).not.toContain( 'cdn.example' );
		expect( html ).toContain( 'href="https://example.com/"' );
		expect( html ).toContain( 'href="https://external.example/about"' );
		expect( html ).toContain( 'href="/assets/css/site.css"' );
		expect( html ).toContain( 'src="/media/kept.png"' );
		expect( html ).toContain( 'srcset="/media/kept.png 800w"' );
		expect( html ).toContain( 'data:image/gif;base64,' );
		expect( html ).toContain( 'about:blank' );
	} );

	it( 'drops 1x1 gif placeholders from srcset so the browser cannot pick them', () => {
		const html = stripRemoteAssetRequests(
			'<img width="2660" src="/files/hero.png" srcset="/media/hero-2660.png 2660w, data:image/gif;base64, R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs= 1536w, /media/hero-2048.png 2048w"><source srcset="R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">'
		);
		expect( html ).not.toMatch( /srcset="[^"]*data:image\/gif/ );
		expect( html ).not.toContain( 'srcset="R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="' );
		expect( html ).toContain( 'srcset="/media/hero-2660.png 2660w, /media/hero-2048.png 2048w"' );
		expect( html ).toContain( 'src="/files/hero.png"' );
	} );

	it( 'serializes local srcset URLs with Wix transform commas, spaces, and apostrophes', () => {
		const url = "/external/v1/crop/x_59,y_0,w_3152,h_3152/fill/w_200,h_200/Happy Women's Day.jpg";
		const html = stripRemoteAssetRequests( `<img srcset="${ url } 1x">` );
		expect( html ).toContain( `srcset="${ url.replaceAll( ' ', '%20' ) } 1x"` );
	} );

	it( 'filters remote srcset candidates without corrupting local comma paths', () => {
		const url = "/external/v1/crop/x_59,y_0,w_3152,h_3152/fill/w_200,h_200/Happy Women's Day.jpg";
		const html = stripRemoteAssetRequests(
			`<img srcset="https://cdn.example/remote.jpg 2x, ${ url } 1x">`
		);
		expect( html ).not.toContain( 'cdn.example' );
		expect( html ).toContain( `srcset="${ url.replaceAll( ' ', '%20' ) } 1x"` );
	} );

	it( 'drops a sourceMappingURL comment pointing at a non-local origin, keeping a local one', () => {
		expect(
			stripRemoteCssUrls(
				'.a{color:red}/*# sourceMappingURL=https://static.parastorage.com/main.css.map */'
			)
		).toBe( '.a{color:red}' );
		expect(
			stripRemoteCssUrls( '.a{color:red}/*# sourceMappingURL=/external/main.css.map */' )
		).toBe( '.a{color:red}/*# sourceMappingURL=/external/main.css.map */' );
	} );

	it( 'strips remote sourceMappingURL comments out of inlined style blocks', () => {
		const html = stripRemoteAssetRequests(
			'<style>.a{color:red}/*# sourceMappingURL=https://static.parastorage.com/main.css.map */</style>'
		);
		expect( html ).not.toContain( 'sourceMappingURL' );
		expect( html ).not.toContain( 'static.parastorage.com' );
	} );

	it( 'drops data-url and data-href provenance attributes that name a remote origin', () => {
		const html = stripRemoteAssetRequests(
			'<style data-href="https://static.parastorage.com/dist/main.css" data-url="https://static.parastorage.com/dist/main.css">.a{color:red}</style><div data-href="/local/path">kept</div>'
		);
		expect( html ).not.toContain( 'static.parastorage.com' );
		expect( html ).toContain( 'data-href="/local/path"' );
	} );

	it( 'neutralizes leftover remote CSS urls without touching local ones', () => {
		expect(
			stripRemoteCssUrls(
				'.a{background:url("https://cdn.example/a.jpg")}.b{background:url("/media/b.jpg")}'
			)
		).toBe(
			'.a{background:url("about:blank")}.b{background:url("/media/b.jpg")}'
		);
	} );

	it( 'omits empty @font-face src sentinels so later woff/ttf sources remain usable', () => {
		expect(
			stripRemoteCssUrls(
				'@font-face{font-family:"icon";src:url("https://cdn.example/icon.eot");src:url("https://cdn.example/icon.eot?#iefix") format("embedded-opentype"),url("/fonts/icon.woff") format("woff"),url("/fonts/icon.ttf") format("truetype")}.hero{background:url("https://cdn.example/missing.jpg")}'
			)
		).toBe(
			'@font-face{font-family:"icon";src:url("/fonts/icon.woff") format("woff"),url("/fonts/icon.ttf") format("truetype")}.hero{background:url("about:blank")}'
		);
	} );

	it( 'still recognizes the legacy empty data URL sentinel emitted by earlier captures', () => {
		// Emission moved to about:blank, but the legacy sentinel still arrives inside
		// source stylesheets, so recognition must keep matching both forms.
		expect(
			stripRemoteCssUrls(
				'@font-face{font-family:"icon";src:url("about:blank");src:url("about:blank#iefix") format("embedded-opentype"),url("/fonts/icon.woff") format("woff")}'
			)
		).toBe( '@font-face{font-family:"icon";src:url("/fonts/icon.woff") format("woff")}' );
	} );

	it( 'drops injected empty @font-face src sentinels including #iefix fragments', () => {
		expect(
			stripRemoteCssUrls(
				'@font-face{font-family:"icon";src:url(data:application/octet-stream;base64,);src:url(data:application/octet-stream;base64,#iefix) format("embedded-opentype"),url("/fonts/icon.woff") format("woff"),url("/fonts/icon.ttf") format("truetype")}'
			)
		).toBe(
			'@font-face{font-family:"icon";src:url("/fonts/icon.woff") format("woff"),url("/fonts/icon.ttf") format("truetype")}'
		);
	} );

	it( 'rewrites leftover remotes already written into a website tree', () => {
		const websiteDir = mkdtempSync( join( tmpdir(), 'dla-self-contain-' ) );
		mkdirSync( join( websiteDir, 'assets', 'css' ), { recursive: true } );
		writeFileSync(
			join( websiteDir, 'index.html' ),
			'<link rel="preconnect" href="https://runtime.example"><a href="https://other.example/x">x</a>'
		);
		writeFileSync(
			join( websiteDir, 'assets', 'css', 'site.css' ),
			'.x{background:url("https://runtime.example/x.png")}'
		);
		selfContainWebsite( websiteDir );
		const html = readFileSync( join( websiteDir, 'index.html' ), 'utf8' );
		expect( html ).not.toContain( 'runtime.example' );
		expect( html ).toContain( 'href="https://other.example/x"' );
		expect( readFileSync( join( websiteDir, 'assets', 'css', 'site.css' ), 'utf8' ) ).not.toContain(
			'runtime.example'
		);
	} );
} );
