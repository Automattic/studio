import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { learnAndApplyFluidGeometry } from './fluid-capture.js';

describe( 'learnAndApplyFluidGeometry', () => {
	let browser: Browser;

	beforeAll( async () => {
		browser = await chromium.launch();
	} );

	afterAll( async () => {
		await browser.close();
	} );

	it( 'learns a responsive top offset only for captured anchor targets', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<span id="features" data-dla-anchor-target="features" data-dla-anchor-source-id="feature-section" style="position:absolute;top:787px;width:0;height:0"></span>
			<div id="ordinary" style="position:absolute;top:144px;width:100px;height:100px"></div>
			<section id="feature-section" style="position:absolute;top:787px"></section>
			<script>
				const update = () => {
					document.querySelector('#feature-section').style.top = (innerWidth * 0.5464) + 'px';
				};
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		expect( await page.locator( '#features' ).getAttribute( 'style' ) ).toContain( 'top: 54.64vw' );
		expect( await page.locator( '#ordinary' ).getAttribute( 'style' ) ).toContain( 'top:144px' );
		await page.close();
	} );

	it( 'keeps container-derived heights definite after runtime removal', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<div id="runtime-parent"><div id="canvas" style="height:720px"></div></div>
			<script>
				const update = () => {
					const height = innerWidth * 0.5;
					document.querySelector('#runtime-parent').style.height = height + 'px';
					document.querySelector('#canvas').style.height = height + 'px';
				};
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		expect( await page.locator( '#canvas' ).getAttribute( 'style' ) ).toContain( 'height: 50vw' );
		await page.locator( '#runtime-parent' ).evaluate( ( element ) => {
			element.style.height = 'auto';
		} );
		expect( await page.locator( '#canvas' ).evaluate( ( element ) => element.getBoundingClientRect().height ) ).toBeGreaterThan( 1 );
		await page.close();
	} );
} );
