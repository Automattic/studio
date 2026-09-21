import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { capture } from './capture.js';

describe.skipIf( ! existsSync( chromium.executablePath() ) )( 'Wix runtime anchor capture', () => {
	it.each( [ 0, 600, -1 ] )( 'observes scroll from a trusted click with delay %i', async ( delay ) => {
		const browser = await chromium.launch( { headless: true } );
		try {
			const page = await browser.newPage();
			await page.route( 'https://anchor.test/**', ( route ) => route.fulfill( {
				contentType: 'text/html',
				body: `<style>body{margin:0}nav{position:fixed;top:0;z-index:5}section{height:1000px}</style>
					<nav><a href="#runtime-section">Section</a></nav>
					<section>First</section><section id="section-source">Destination</section><section>Last</section>
					<script>document.querySelector('a').addEventListener('click', event => {
						event.preventDefault();
						if (!event.isTrusted || ${ delay } < 0) return;
						const move = () => window.scrollTo({top:1000,behavior:'instant'});
						if (${ delay } === 0) move(); else setTimeout(move, ${ delay });
					});</script>`,
			} ) );
			await page.goto( 'https://anchor.test/' );
			await capture.prepare!( page, { url: page.url(), viewport: 'desktop' } );
			if ( delay < 0 ) {
				expect( await page.locator( '#runtime-section' ).count() ).toBe( 0 );
				expect( await page.locator( 'a' ).getAttribute( 'data-dla-anchor-unresolved' ) ).toContain( 'did not move' );
			} else {
				expect( await page.locator( '#runtime-section' ).count() ).toBe( 1 );
				expect( await page.locator( '#runtime-section' ).evaluate( ( node ) => ( node as HTMLElement ).style.top ) ).toBe( '1000px' );
				expect( await page.locator( 'a' ).getAttribute( 'data-dla-anchor-unresolved' ) ).toBeNull();
			}
		} finally {
			await browser.close();
		}
	}, 20_000 );
} );
