import { existsSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSharedBrowser, getSharedBrowser } from '@studio/agent/node/browser-utils';
import {
	captureScreenshotBuffer,
	inspectPage,
	renderedCapture,
	forgetRenders,
} from '@studio/agent/node/tools/screenshot-helpers';
import type { AddressInfo } from 'net';

// A real Chromium to load pages with, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() );

// A page whose script fetches content and adds it, 2000px tall, when the
// response arrives 400ms later: the capture shows it only once it has waited.
const fetching = ( when: string ) => `<!doctype html><body style="margin:0">
<script>
const add = () => fetch( '/content' ).then( ( r ) => r.text() ).then( ( html ) => document.body.insertAdjacentHTML( 'beforeend', html ) );
${ when }
</script></body>`;

const PAGES: Record< string, string > = {
	'/inline': fetching( 'add();' ),
	'/on-load': fetching( "addEventListener( 'load', add );" ),
	'/after-a-frame': fetching( "addEventListener( 'load', () => requestAnimationFrame( add ) );" ),
	'/image': `<!doctype html><body style="margin:0"><img src="/slow.svg"></body>`,
};
const STILL = '<!doctype html><p>Nothing to load</p>';
// A background fixed to the viewport on the page, and on a section further
// down, as a parallax cover block has it.
const FIXED = `<!doctype html><body style="margin:0;background:linear-gradient(#000010,#100000) fixed">
<div style="height:900px"></div><div style="height:300px;background:linear-gradient(#ff0000,#ff0000) fixed"></div></body>`;

describe.runIf( CHROMIUM )( 'capturing a page', () => {
	let server: http.Server;
	let siteUrl: string;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			const later = ( type: string, body: string ) =>
				setTimeout( () => {
					response.writeHead( 200, { 'content-type': type } );
					response.end( body );
				}, 400 );
			if ( request.url === '/checkout' ) {
				response.writeHead( 302, { location: '/cart' } );
				response.end();
			} else if ( request.url === '/content' ) {
				later( 'text/html', '<div style="height:2000px">Loaded</div>' );
			} else if ( request.url === '/slow.svg' ) {
				later(
					'image/svg+xml',
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="2000"></svg>'
				);
			} else {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end( request.url === '/fixed' ? FIXED : PAGES[ request.url ?? '' ] ?? STILL );
			}
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		siteUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
	} );

	it.each( [ true, false ] )(
		'reports the redirected address (fullPage=%s)',
		async ( fullPage ) => {
			const capture = await captureScreenshotBuffer(
				`${ siteUrl }/checkout`,
				{ width: 400, height: 300 },
				{ fullPage }
			);
			expect( capture.url ).toBe( `${ siteUrl }/cart` );
		}
	);

	it( 'keeps redirect identity when reusing a rendered capture', async () => {
		const viewport = { width: 400, height: 300 };
		await inspectPage( `${ siteUrl }/checkout`, viewport );
		expect( ( await renderedCapture( `${ siteUrl }/checkout`, viewport, true ) )?.url ).toBe(
			`${ siteUrl }/cart`
		);
		forgetRenders();
	} );

	it.each< string >( Object.keys( PAGES ) )(
		'waits for what %s loads before it captures',
		async ( page ) => {
			const capture = await captureScreenshotBuffer(
				`${ siteUrl }${ page }`,
				{ width: 400, height: 300 },
				{ fullPage: true, format: 'jpeg' }
			);

			expect( capture.documentHeight ).toBeGreaterThanOrEqual( 2000 );
		},
		60000
	);

	it( 'paints backgrounds fixed to the viewport below the first screen of a full page', async () => {
		const capture = await captureScreenshotBuffer(
			`${ siteUrl }/fixed`,
			{ width: 400, height: 300 },
			{ fullPage: true }
		);
		const page = await ( await getSharedBrowser() ).newPage();
		const [ below, section ] = await page.evaluate(
			async ( src ) => {
				const image = new Image();
				image.src = src;
				await image.decode();
				const canvas = document.createElement( 'canvas' );
				canvas.width = image.width;
				canvas.height = image.height;
				const context = canvas.getContext( '2d' )!;
				context.drawImage( image, 0, 0 );
				const at = ( y: number ) =>
					Array.from( context.getImageData( 200, y, 1, 1 ).data.slice( 0, 3 ) );
				return [ at( 600 ), at( 1000 ) ];
			},
			`data:image/png;base64,${ capture.buffer.toString( 'base64' ) }`
		);
		await page.close();
		expect( Math.max( ...below ) ).toBeLessThan( 40 );
		expect( section ).toEqual( [ 255, 0, 0 ] );
	}, 60000 );

	it( 'captures a page once its requests finish, short of the most it waits', async () => {
		const started = Date.now();
		await captureScreenshotBuffer(
			`${ siteUrl }/still`,
			{ width: 400, height: 300 },
			{ fullPage: false, format: 'jpeg' }
		);

		// It waits 2500ms at most for a page's requests (PAGE_SETTLE_TIMEOUT_MS).
		expect( Date.now() - started ).toBeLessThan( 2000 );
	}, 60000 );
} );
