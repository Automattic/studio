import { existsSync } from 'fs';
import http from 'http';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSharedBrowser } from '@studio/agent/node/browser-utils';
import { captureScreenshotBuffer } from '@studio/agent/node/tools/screenshot-helpers';
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
			if ( request.url === '/content' ) {
				later( 'text/html', '<div style="height:2000px">Loaded</div>' );
			} else if ( request.url === '/slow.svg' ) {
				later(
					'image/svg+xml',
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="2000"></svg>'
				);
			} else {
				response.writeHead( 200, { 'content-type': 'text/html' } );
				response.end( PAGES[ request.url ?? '' ] ?? STILL );
			}
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		siteUrl = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
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
