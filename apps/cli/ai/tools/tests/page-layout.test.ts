import { existsSync } from 'fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pageLayout } from 'cli/ai/tools/page-layout';

type Browser = Awaited< ReturnType< typeof chromium.launch > >;

// A real browser lays the page out, wherever Playwright's Chromium is installed.
describe.runIf( existsSync( chromium.executablePath() ) )( 'the page layout', () => {
	let browser: Browser;
	beforeAll( async () => {
		browser = await chromium.launch();
	} );
	afterAll( () => browser.close() );

	const layoutOf = async ( body: string ) => {
		const page = await browser.newPage( { viewport: { width: 1000, height: 800 } } );
		await page.setContent( `<style>body,h1,p{margin:0}</style><body>${ body }</body>` );
		try {
			return await pageLayout( page );
		} finally {
			await page.close();
		}
	};

	it( "states where each region and main's blocks render, past a wrapper", async () => {
		expect(
			await layoutOf( `<div class="wp-site-blocks">
				<header class="wp-block-template-part"><div class="wp-block-group" style="display:flex;justify-content:space-between;align-items:flex-start"><p class="wp-block-site-title" style="height:80px;width:200px;margin:0"></p><nav class="wp-block-navigation" style="height:40px;width:300px"></nav></div></header>
				<main class="wp-block-group is-layout-flow"><div class="wp-block-group">
					<section id="hero" class="wp-block-cover poster has-base-color" style="height:600px"><div class="wp-block-cover__inner-container"><h1 style="height:60px"></h1><p style="height:40px"></p></div></section>
					<section class="wp-block-group wp-container-core-group-is-layout-1" style="height:300px;width:500px;margin-left:250px"></section>
					<section style="display:none;height:50px"></section>
				</div></main>
				<footer style="height:100px"></footer>
			</div>` )
		).toEqual( [
			'header.wp-block-template-part: y 0–80 (80px tall), x 0–1000',
			'  p.wp-block-site-title: y 0–80 (80px tall), x 0–200',
			'  nav.wp-block-navigation: y 0–40 (40px tall), x 700–1000',
			'main.wp-block-group: y 80–980 (900px tall), x 0–1000',
			'  section#hero.wp-block-cover.poster: y 80–680 (600px tall), x 0–1000',
			'  section.wp-block-group: y 680–980 (300px tall), x 250–750',
			'footer: y 980–1080 (100px tall), x 0–1000',
		] );
	} );

	it( 'says when the page is wider than its viewport', async () => {
		expect( await layoutOf( '<div style="width:1400px;height:10px"></div>' ) ).toEqual( [
			'div: y 0–10 (10px tall), x 0–1400',
			'The page is 1400px wide in a 1000px viewport, so it scrolls sideways.',
		] );
	} );

	it( 'counts the regions past its limit', async () => {
		const layout = await layoutOf( '<p style="height:5px"></p>'.repeat( 45 ) );
		expect( layout ).toHaveLength( 41 );
		expect( layout.at( -1 ) ).toBe( '…and 5 more' );
	} );
} );
