import { existsSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSharedBrowser } from '@studio/agent/node/browser-utils';
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
// wider than a phone and the page's background between its header and main
// (eval19: 5 of 5 branch sites), as a server with an error answers it.
const BROKEN = `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0"><br />
<b>Warning</b>:  Undefined variable $hours in <b>/srv/wp-content/themes/bakery/functions.php</b> on line <b>12</b><br />
<div class="wp-site-blocks">
<header style="background:#123;height:60px"></header>
<main style="background:#eee;margin-top:24px"><img src="/missing.jpg" alt="Loaves"><div class="price-row" style="width:900px">Prices</div></main>
</div></body>`;

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
			] )
		);
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
