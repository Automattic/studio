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
	// An icon beside its words, centered together as the paragraph's own row.
	icon: `<div style="width:160px;margin:auto;text-align:center"><p style="display:flex;justify-content:center;gap:8px"><span style="font-size:30px">*</span> 128 Brightside Way, Suite 200</p></div>`,
};

// eval17 and eval18's home pages as a visitor sees them, in one: what each fault looks like, and what is not one, as a ticker running across the window
// or an eyebrow above a display heading set tighter than its type (eval24's redo runs), whose letters start below it.
const PAGE = `<p class="skip" style="position:absolute;left:0;clip-path:inset(50%)">Skip to content</p>
	<section style="padding:0 40px"><p>A welcome set in from the window's edge.</p></section>
	<section><p>A welcome against the window's edge.</p></section>
	<section style="position:relative;padding:0 40px"><p>A heading under an overlay</p><div style="position:absolute;inset:0;background:rgba(0,0,0,.5)"></div></section>
	<section style="padding:0 40px"><p style="margin:0;font-size:13px">An eyebrow above a display heading</p><h2 style="margin:12px 0 0;font-size:152px;line-height:.86">Ink that</h2></section>
	<section style="padding:0 40px"><p style="margin:0;font-size:13px">An eyebrow a heading is pulled over</p><h2 style="margin:-12px 0 0;font-size:60px;line-height:1;background:#fff">Pulled up</h2></section>
	<section style="padding:40px;background:#3a3550"><p style="color:#423d5c">Invisible links on the footer</p><p style="color:#fff">Readable footer text</p><p style="color:color(srgb 0.95 0.95 0.91 / 0.75)">Readable see-through text</p><a style="color:#2a3038"><span style="color:#fff">A button's own label</span></a></section>
	<section style="padding:40px;background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=) #fff"><p style="color:#fff">White text on a photo</p></section>
	<section style="position:relative;padding:40px;background:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)"><span style="position:absolute;inset:0;background:#12314f;opacity:.4"></span><p style="position:relative;color:#12314f">Dark text on a photo, dimmed</p></section>
	<section style="padding:0 40px"><h2 style="font-size:48px">A heading as long as a sentence, set large</h2><ul><li style="font-size:48px">Call us, or book online in under a minute.</li><li>Short</li></ul>
	<blockquote style="font-size:32px">A testimonial set large, as a design does</blockquote>
	<p>Body text for the median size of the page, at sixteen pixels.</p></section>
	<style>@keyframes ticker{to{transform:translateX(-50%)}}</style>
	<section style="overflow:hidden"><div style="display:flex;gap:40px;width:max-content;animation:ticker 20s linear infinite"><p style="white-space:nowrap">Fresh bread daily · Open seven days · Order ahead</p><p style="white-space:nowrap">Fresh bread daily · Open seven days · Order ahead</p><p style="white-space:nowrap">Fresh bread daily · Open seven days · Order ahead</p></div></section>`;

const HEADER = `<header style="display:flex;justify-content:space-between;padding:20px 40px">
	<nav class="wp-block-navigation"><a href="/">Home</a> <a href="/services/">Services</a></nav>
	<div style="display:flex;gap:20px"><p style="font-size:24px">SPOKE <span>&amp;</span> CHAIN</p><a href="/contact/">book a repair</a></div></header>
	<main><h1 style="font-size:40px">Your bike on the road, fast.</h1><h2 style="font-size:56px">what we fix</h2></main>`;

describe.runIf( CHROMIUM )( 'the eval home page styles', () => {
	let server: http.Server;
	let url: string;
	beforeAll( async () => {
		server = http.createServer( ( request, response ) => {
			response.writeHead( 200, { 'content-type': 'text/html' } );
			response.end(
				request.url === '/page'
					? `<!doctype html><body style="margin:0;font-size:16px">${ PAGE }</body>`
					: request.url === '/header'
					? `<!doctype html><body style="margin:0">${ HEADER }</body>`
					: `<!doctype html><body style="margin:0"><main>Home</main><footer style="width:1000px;margin:auto">${
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
		[ 'icon', false ],
	] )(
		'measures the %s footer as off center: %s',
		async ( footer, off ) => {
			const styles = ( await homeStyles( url + footer, 'Brightside Family Dental' ) ) as {
				footerText: { offCenter: number }[];
			};
			const farthest = Math.max( ...styles.footerText.map( ( text ) => text.offCenter ) );

			expect( farthest > 8 ).toBe( off );
		},
		60000
	);

	// eval23 picky port 1: the name a paragraph, and the hero h1 smaller than a section's h2.
	it( "finds the site's name in the header by its text, and the first screen's h1 as its top title", async () => {
		const styles = ( await homeStyles( url + 'header', 'Spoke & Chain' ) ) as {
			navLeft: number;
			titleLeft: number;
			headings: { text: string; first: boolean }[];
		};
		expect( styles.titleLeft ).toBeGreaterThan( styles.navLeft );
		expect( styles.headings.filter( ( heading ) => heading.first ) ).toEqual( [
			expect.objectContaining( { text: 'Your bike on the road, fast.' } ),
		] );
	}, 60000 );

	// eval25 picky port 1 and 4: a color in color(srgb …) read as near black, and a
	// link's own color read for the label it sets in a span of its own color.
	it( 'names the faults a visitor sees at a glance, and only those', async () => {
		const { faults } = ( await homeStyles( url + 'page', 'Brightside Family Dental' ) ) as {
			faults: string[];
		};
		expect(
			faults.map( ( fault ) => fault.replace( /\(x .*\)|, [\d.]+:1|\d+(\.\d+)?px/g, '' ) )
		).toEqual( [
			`"A welcome against the window's edge." touches the window's edge `,
			'"A heading under an overlay" is under div',
			'"An eyebrow a heading is pulled over" is under h2',
			'"Invisible links on the footer" is rgb(66, 61, 92) on rgb(58, 53, 80)',
			'"Call us, or book online in under a minut…" is , body text ',
		] );
	}, 60000 );
} );
