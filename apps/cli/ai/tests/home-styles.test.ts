import { existsSync } from 'fs';
import http from 'http';
import { closeSharedBrowser } from '@studio/agent/node/browser-utils';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { homeStyles } from 'cli/ai/eval-outcome';
import type { AddressInfo } from 'net';

// A real Chromium to load pages with, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() );

const row = 'display:flex;flex-direction:row;gap:40px';
const FOOTERS: Record< string, string > = {
	// Columns of different heights, each centered, side by side in a centered stack.
	columns: `<div class="is-layout-flex is-vertical" style="display:flex;flex-direction:column;align-items:center;text-align:center">
		<p>Gentle dentistry for every member of your family.</p>
		<div class="is-layout-flex" style="${ row };align-items:center">
			<div><p>Visit us</p><p>1240 Oakwood Lane<br>Maplewood</p></div>
			<div><p>Hours</p><p>Mon: 8–6<br>Fri: 8–3<br>Sat: 9–1<br>Sun: closed</p></div>
			<div><p>Contact</p><p>(503) 555-0142</p></div>
		</div></div>`,
	// A logo beside a title that wraps, centered in a narrow column.
	logo: `<div style="width:150px;margin:auto;text-align:center">
		<div class="is-layout-flex" style="${ row };justify-content:center;gap:8px"><img style="width:40px;height:20px;background:#333">
		<p style="margin:0">Brightside Family Dental</p></div></div>`,
	left: `<p>© 2025 Brightside Family Dental</p>`,
	links: `<div class="is-layout-flex" style="${ row }"><a href="#">Privacy</a><a href="#">Terms</a></div>`,
};

describe.runIf( CHROMIUM )( 'the eval home page styles', () => {
	let server: http.Server;
	let url: string;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end(
				`<!doctype html><body style="margin:0"><main>Home</main><footer style="width:1000px;margin:auto">${
					FOOTERS[ request.url?.slice( 1 ) ?? '' ]
				}</footer></body>`
			);
		} );
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		url = `http://127.0.0.1:${ ( server.address() as AddressInfo ).port }/`;
	} );
	afterAll( async () => {
		await closeSharedBrowser();
		server.close();
	} );

	it.each( [
		[ 'columns', false ],
		[ 'logo', false ],
		[ 'left', true ],
		[ 'links', true ],
	] )(
		'measures the %s footer as off center: %s',
		async ( footer, off ) => {
			const styles = ( await homeStyles( url + footer ) ) as {
				footerText: { offCenter: number }[];
			};
			const farthest = Math.max( ...styles.footerText.map( ( text ) => text.offCenter ) );

			expect( farthest > 8 ).toBe( off );
		},
		60000
	);
} );
