import { existsSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSharedBrowser, getSharedBrowser } from '@studio/agent/node/browser-utils';
import { pageTextFit } from '@studio/agent/node/tools/page-layout';
import {
	forgetRenders,
	inspectPage,
	renderedCapture,
	VIEWPORTS,
} from '@studio/agent/node/tools/screenshot-helpers';
import type { AddressInfo } from 'net';

// A real Chromium to load pages with, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() );

const PIXEL = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

// A page as a block theme renders it: everything fits and loads.
const HEALTHY = `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0"><div class="wp-site-blocks" style="padding:0 20px">
<header><p style="font-size:12px">Bakery, open every morning from seven</p></header>
<main style="font-size:1.2rem"><h1>Fresh bread daily</h1><img src="/pixel.png" style="max-width:100%">
<p>Open every morning from seven until noon.</p><p>Sourdough, rye and seeded loaves.</p>
<p style="font-size:30px">Order a birthday cake two days ahead.</p></main>
<footer style="font-size:10px"><p>Bakery, 12 Main Street, Springfield</p><p>Call us on 555 0100 to order</p><p>Copyright Bakery, all rights reserved</p></footer>
</div></body>`;

// The same page with PHP's error output, an image that is not there, a row
// wider than a phone, the page's background between its header and main
// (eval19: 5 of 5 branch sites), a header row that wraps and text against the
// viewport's edge, as a server with an error answers it.
const BROKEN = `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0"><br />
<b>Warning</b>:  Undefined variable $hours in <b>/srv/wp-content/themes/bakery/functions.php</b> on line <b>12</b><br />
<div class="wp-site-blocks">
<header style="background:#123;display:flex;flex-wrap:wrap"><p style="width:240px;margin:0">Bakery</p><p style="width:240px;margin:0">Order a cake</p></header>
<main style="background:#eee;margin-top:24px"><img src="/missing.jpg" alt="Loaves"><div class="price-row" style="width:900px">Prices</div></main>
</div></body>`;

// Text that does and does not fit a phone, as eval29's runs had it: a button
// in a column of a row of columns that does not stack on a phone (picky port
// 1), a form's honeypot label placed off the screen and a marquee whose track
// runs past the band that clips it (redo ports 1, 3 and 4), and a paragraph
// that does start at the viewport's left edge.
const FIT = `<!doctype html><meta name="viewport" content="width=device-width">
<style>
.wp-block-columns { display: flex; gap: 24px; }
.wp-block-column { flex: 1 1 0; min-width: 0; word-break: break-word; overflow-wrap: break-word; }
.wp-block-button__link { display: inline-block; padding: 8px 12px; word-break: break-word; }
.track { margin: 0; white-space: nowrap; width: max-content; transform: translateX(-200px); }
</style>
<body style="margin:0"><main style="padding:0 20px">
<div class="wp-block-columns is-layout-flex wp-container-core-columns-is-layout-1 wp-block-columns-is-layout-flex is-not-stacked-on-mobile">
<div class="wp-block-column is-layout-flow wp-block-column-is-layout-flow"><div class="wp-block-buttons is-layout-flex"><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/book/">Book now</a></div></div></div>
<div class="wp-block-column"><p>Ink</p></div><div class="wp-block-column"><p>Art</p></div><div class="wp-block-column"><p>Fun</p></div><div class="wp-block-column"><p>Pen</p></div>
</div>
<p><a class="wp-block-button__link wp-element-button" href="/book/">Book a table</a></p>
<form><p style="position:absolute;left:-9999px">Leave this field empty</p></form>
<div style="overflow:hidden"><p class="track">FINE LINE · TRADITIONAL · BLACK & GREY · FINE LINE · TRADITIONAL</p></div>
</main>
<div style="overflow:hidden"><p class="track">BOOKED BY APPOINTMENT · CUSTOM FINE LINE · BOOKED BY APPOINTMENT</p></div>
<p style="margin:0">Walk-ins welcome every Saturday</p>
</body>`;

describe.runIf( CHROMIUM )( 'inspecting a page', () => {
	let formText = 'Book a table';
	let server: http.Server;
	let siteUrl: string;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			if ( request.url === '/pixel.png' ) {
				response.writeHead( 200, { 'content-type': 'image/png' } );
				response.end( PIXEL );
			} else if ( request.url === '/' ) {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end( HEALTHY );
			} else if ( request.url === '/form/' ) {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end(
					`${ HEALTHY }<form><input type='hidden' name='_wpnonce' value='${ Math.random() }'><p>${ formText }</p></form>`
				);
			} else if ( request.url === '/large/' ) {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end(
					HEALTHY.replace(
						'</footer>',
						'<p style="font-size:57.6px">Every loaf is shaped by hand before dawn</p></footer>'
					)
				);
			} else if ( request.url === '/fit/' ) {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end( FIT );
			} else if ( request.url === '/broken/' ) {
				response.writeHead( 500, { 'content-type': 'text/html' } );
				response.end( BROKEN );
			} else {
				response.writeHead( 404 );
				response.end();
			}
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		siteUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
	} );

	it.each( [ 'desktop', 'mobile' ] as const )(
		'finds nothing wrong with a healthy page at %s, and the size its body text renders at',
		async ( viewport ) => {
			const { problems, bodyFontSize } = await inspectPage(
				`${ siteUrl }/`,
				VIEWPORTS[ viewport ]
			);
			expect( problems ).toEqual( [] );
			expect( bodyFontSize ).toBe( 19.2 );
		},
		60000
	);

	it( 'names what a visitor gets that is broken', async () => {
		const { problems } = await inspectPage( `${ siteUrl }/broken/`, VIEWPORTS.mobile );

		expect( problems ).toEqual(
			expect.arrayContaining( [
				'The server answers 500.',
				'PHP printed "Warning: Undefined variable $hours" (/srv/wp-content/themes/bakery/functions.php:12).',
				`The image ${ siteUrl }/missing.jpg did not load.`,
				expect.stringMatching( /^The page is \d+px wide in a 390px viewport/ ),
				expect.stringMatching(
					/^The page's background shows as a strip between full-width blocks/
				),
				expect.stringMatching( /^ {2}y \d+–\d+ \(24px\), between header and main$/ ),
				expect.stringMatching(
					/^The header lays its 2 items out in a row.*"Order a cake" starts a line/
				),
				// The heading with its lines, as one problem a report lists once across pages.
				expect.stringMatching(
					/^Text against the viewport's edge:\n(.*\n)* {2}p "Bakery": its text starts at the viewport's left edge \(x 0\)\./
				),
			] )
		);
		expect( problems ).not.toContain( "Text against the viewport's edge:" );
	}, 60000 );

	it( "states text against the viewport's edge that a visitor sees, and what narrows a box a word breaks in", async () => {
		const { problems } = await inspectPage( `${ siteUrl }/fit/`, VIEWPORTS.mobile );
		const edges = problems.filter( ( problem ) =>
			problem.startsWith( "Text against the viewport's edge:" )
		);

		// Not the honeypot label off the screen, nor a marquee's track past the
		// band that clips it, whether the band is inside the viewport or across it.
		expect( edges ).toEqual( [
			[
				"Text against the viewport's edge:",
				`  p "Walk-ins welcome every Saturday": its text starts at the viewport's left edge (x 0).`,
			].join( '\n' ),
		] );
		const page = await ( await getSharedBrowser() ).newPage( { viewport: VIEWPORTS.mobile } );
		try {
			await page.goto( `${ siteUrl }/fit/` );
			const { breaks } = await pageTextFit( page );
			// The button by its text, as every button shares its classes, in the
			// column of the row of columns that does not stack that narrows it.
			expect( breaks ).toContainEqual(
				expect.stringMatching(
					/^a\.wp-block-button__link\.wp-element-button "Book now": the browser breaks "Book" across lines, as the word \(\d+px\) is wider than its box \(\d+px\) in div\.wp-block-column in div\.wp-block-columns\.is-not-stacked-on-mobile\.$/
				)
			);
		} finally {
			await page.close();
		}
	}, 60000 );

	it( "names paragraph text the size of a heading, against the page's body text", async () => {
		const { problems, bodyFontSize } = await inspectPage(
			`${ siteUrl }/large/`,
			VIEWPORTS.desktop
		);
		expect( bodyFontSize ).toBe( 19.2 );
		expect( problems ).toEqual( [
			'p "Every loaf is shaped by hand before dawn" is 57.6px, 3 times the 19.2px body text; text this large reads as a heading.',
		] );
	}, 60000 );

	it( 'answers a screenshot from the render while the page serves the same HTML', async () => {
		const url = `${ siteUrl }/form/`;
		await inspectPage( url, VIEWPORTS.desktop );

		// A fresh nonce on each request is the same page.
		const capture = await renderedCapture( url, VIEWPORTS.desktop, true );
		expect( capture?.buffer.length ).toBeGreaterThan( 0 );
		expect( ( await renderedCapture( url, VIEWPORTS.desktop, false ) )?.clipped ).toBe( false );
		expect( await renderedCapture( url, VIEWPORTS.mobile, true ) ).toBeUndefined();
		await inspectPage( `${ siteUrl }/`, VIEWPORTS.desktop );
		expect( await renderedCapture( siteUrl, VIEWPORTS.desktop, true ) ).toBeDefined();

		formText = 'Book a room';
		expect( await renderedCapture( url, VIEWPORTS.desktop, true ) ).toBeUndefined();

		formText = 'Book a table';
		forgetRenders();
		expect( await renderedCapture( url, VIEWPORTS.desktop, true ) ).toBeUndefined();
	}, 60000 );
} );
