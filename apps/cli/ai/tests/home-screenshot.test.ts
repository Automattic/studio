import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeSharedBrowser } from 'cli/ai/browser-utils';
import { saveHomeScreenshot } from 'cli/ai/eval-outcome';
import type { AddressInfo } from 'net';

// A real Chromium to load pages with, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() );

// A hero as tall as the window, then 600px of content.
const HOME = `<!doctype html><body style="margin:0">
<section style="height:100vh;background:#345"></section>
<section style="height:600px;background:#eee"></section>
</body>`;

// A JPEG's height, from its start-of-frame segment.
function jpegHeight( buffer: Buffer ): number {
	for ( let at = 2; at < buffer.length; at += 2 + buffer.readUInt16BE( at + 2 ) ) {
		if ( buffer[ at + 1 ] >= 0xc0 && buffer[ at + 1 ] <= 0xc2 ) {
			return buffer.readUInt16BE( at + 5 );
		}
	}
	return 0;
}

describe.runIf( CHROMIUM )( 'the eval home page screenshot', () => {
	let server: http.Server;
	let url: string;
	let dir: string;
	beforeAll( async () => {
		dir = mkdtempSync( path.join( os.tmpdir(), 'home-shot-' ) );
		server = http.createServer( ( request, response ) => {
			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end( HOME );
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		url = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }/`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
		rmSync( dir, { recursive: true, force: true } );
	} );

	it( 'shows a window-tall section as tall as a visitor sees it, and the page below it', async () => {
		const file = path.join( dir, 'site-home.jpg' );

		expect( await saveHomeScreenshot( url, file ) ).toBe( true );
		expect( jpegHeight( readFileSync( file ) ) ).toBe( 900 + 600 );
	}, 60000 );

	it( 'reports a page it cannot load as not saved', async () => {
		expect( await saveHomeScreenshot( 'http://127.0.0.1:1/', path.join( dir, 'none.jpg' ) ) ).toBe(
			false
		);
	}, 60000 );
} );
