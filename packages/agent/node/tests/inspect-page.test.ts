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
<header><p>Bakery</p></header>
<main><h1>Fresh bread daily</h1><img src="/pixel.png" style="max-width:100%"><p>Open every morning.</p></main>
</div></body>`;

// The same page with PHP's error output, an image that is not there and a
// row wider than a phone, as a server with an error answers it.
const BROKEN = `<!doctype html><meta name="viewport" content="width=device-width">
<body style="margin:0"><br />
<b>Warning</b>:  Undefined variable $hours in <b>/srv/wp-content/themes/bakery/functions.php</b> on line <b>12</b><br />
<div class="wp-site-blocks" style="padding:0 20px">
<main><img src="/missing.jpg" alt="Loaves"><div class="price-row" style="width:900px">Prices</div></main>
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
		'finds nothing wrong with a healthy page at %s',
		async ( viewport ) => {
			expect( ( await inspectPage( `${ siteUrl }/`, VIEWPORTS[ viewport ] ) ).problems ).toEqual(
				[]
			);
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

		formText = 'Book a room';
		expect( await renderedCapture( url, VIEWPORTS.desktop, true ) ).toBeUndefined();

		formText = 'Book a table';
		forgetRenders();
		expect( await renderedCapture( url, VIEWPORTS.desktop, true ) ).toBeUndefined();
	}, 60000 );
} );
