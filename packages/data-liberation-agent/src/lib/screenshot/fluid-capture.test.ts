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

	it( 'keeps a marker coordinate when its source is sticky chrome', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<header id="source" style="position:sticky;top:0;height:40px">Header</header>
			<span id="target" data-dla-anchor-target="target" data-dla-anchor-source-id="source" style="position:absolute;top:640px;width:0;height:0"></span>
			<div style="height:1800px"></div>
		` );

		await learnAndApplyFluidGeometry( page, { widths: [ 768, 1440 ], settleMs: 20 } );

		expect( await page.locator( '#target' ).getAttribute( 'style' ) ).toContain( 'top:640px' );
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

	it( 'learns runtime-written fluid font sizes', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<h1 id="portfolio" style="font-size: 10px">PORTFOLIO</h1>
			<script>
				const update = () => document.querySelector('#portfolio').style.fontSize = (innerWidth * 0.233) + 'px';
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		expect( await page.locator( '#portfolio' ).getAttribute( 'style' ) ).toContain( 'font-size: 23.3vw' );
		await page.evaluate( () => {
			setTimeout( () => {
				document.querySelector< HTMLElement >( '#portfolio' )!.style.fontSize = '336.6px';
			}, 10 );
		} );
		await page.waitForTimeout( 40 );
		expect( await page.locator( '#portfolio' ).getAttribute( 'style' ) ).toContain( 'font-size: 23.3vw' );
		await page.close();
	} );

	it( 'learns the ceiling when the widest sample is capped', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<h1 id="portfolio" style="font-size: 10px">PORTFOLIO</h1>
			<script>
				const update = () => document.querySelector('#portfolio').style.fontSize = Math.min(innerWidth * 0.2, 300) + 'px';
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		expect( await page.locator( '#portfolio' ).getAttribute( 'style' ) ).toContain( 'font-size: min(300px, 20vw)' );
		// At an unsampled width past the switch the ceiling, not the slope, must win.
		await page.setViewportSize( { width: 1600, height: 900 } );
		expect(
			await page.locator( '#portfolio' ).evaluate( ( element ) => getComputedStyle( element ).fontSize )
		).toBe( '300px' );
		await page.close();
	}, 20_000 );

	it( 'ships one rule per regime when the container share changes at the mobile breakpoint', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<style>
				#scaled-container { width: 88vw; }
				@media (min-width: 768px) { #scaled-container { width: 96vw; } }
			</style>
			<div id="scaled-container">
				<h1 id="portfolio" style="font-size: 10px">PORTFOLIO</h1>
			</div>
			<script>
				const update = () => {
					const container = document.getElementById('scaled-container');
					document.getElementById('portfolio').style.fontSize = (container.clientWidth * 0.2434) + 'px';
				};
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 390, 600, 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		// Above 768px the box spans 96% of the viewport but on a phone it
		// spans 88%, so no single vw expression reproduces both regimes. The
		// rules live in a stylesheet keyed by a persistent attribute, and the
		// runtime's inline pixels must not outrank them.
		const style = await page.locator( 'style[data-dla-fluid-rules]' ).textContent();
		expect( style ).toContain( '@media (max-width:767px)' );
		expect( style ).toContain( '21.42vw' );
		expect( style ).toContain( '@media (min-width:768px)' );
		expect( style ).toContain( '23.36vw' );
		expect( await page.locator( '#portfolio' ).getAttribute( 'data-dla-fluid-segment' ) ).toBeTruthy();
		expect( await page.locator( '#portfolio' ).getAttribute( 'style' ) ).not.toContain( 'font-size' );

		// A width the sweep sampled on the mobile regime: the source's own
		// runtime renders 83.5px here; a single desktop fit would render 91.2px.
		await page.setViewportSize( { width: 390, height: 900 } );
		await page.waitForTimeout( 80 );
		const mobileFontSize = await page
			.locator( '#portfolio' )
			.evaluate( ( element ) => parseFloat( getComputedStyle( element ).fontSize ) );
		expect( Math.abs( mobileFontSize - 83.5 ) ).toBeLessThanOrEqual( 2 );

		// The desktop regime must stay exact too.
		await page.setViewportSize( { width: 1440, height: 900 } );
		await page.waitForTimeout( 80 );
		const desktopFontSize = await page
			.locator( '#portfolio' )
			.evaluate( ( element ) => parseFloat( getComputedStyle( element ).fontSize ) );
		expect( Math.abs( desktopFontSize - 0.2434 * 1382 ) ).toBeLessThanOrEqual( 2 );
		await page.close();
	}, 20_000 );

	it( 'keeps segmented rules authoritative when the source runtime writes pixels after learning', async () => {
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		await page.setContent( `
			<style>
				#scaled-container { width: 88vw; }
				@media (min-width: 768px) { #scaled-container { width: 96vw; } }
			</style>
			<div id="scaled-container">
				<h1 id="portfolio" style="font-size: 10px">PORTFOLIO</h1>
			</div>
			<script>
				const update = () => {
					const container = document.getElementById('scaled-container');
					document.getElementById('portfolio').style.fontSize = (container.clientWidth * 0.2434) + 'px';
				};
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 390, 600, 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		expect( await page.locator( 'style[data-dla-fluid-rules]' ).textContent() ).toContain( '21.42vw' );
		// A late runtime write (viewport resize, re-layout) would put back
		// inline pixels, which outrank the stylesheet at every width. The
		// capture must strip them until serialization.
		await page.setViewportSize( { width: 1024, height: 900 } );
		await page.waitForTimeout( 120 );
		expect( await page.locator( '#portfolio' ).getAttribute( 'style' ) ).not.toContain( 'font-size' );
		const fontSize = await page
			.locator( '#portfolio' )
			.evaluate( ( element ) => parseFloat( getComputedStyle( element ).fontSize ) );
		expect( Math.abs( fontSize - 0.2434 * 983 ) ).toBeLessThanOrEqual( 2 );
		await page.close();
	}, 20_000 );

	it( 'learns a runtime-written header offset as media-scoped padding rules', async () => {
		// A fixed header's clearance is written onto the first section as
		// inline pixels: mobile padding is 12vw of chrome plus 37.5px of
		// header content; desktop is chrome content the sweep cannot formula
		// (given here exactly as the live site reported it at the sampled
		// widths). The learned rules must reproduce both regimes and leave
		// the unfittable desktop tail at the value it observed.
		const page = await browser.newPage( { viewport: { width: 1440, height: 900 } } );
		// The site also offsets the section from a more specific author rule
		// reading a runtime variable that is only measured at load, as real
		// platforms do. The runtime's inline pixels outranked that rule; the
		// learned rules replace them, so they must outrank it too — or the
		// copy silently ships the variable's frozen capture-width value.
		await page.setContent( `
			<style>:root { --header-height: 79.0469px; }
			main .sections .page-section:first-child { padding-top: var(--header-height, 100px); }</style>
			<main><div class="sections"><section id="first-section" class="page-section" style="min-height: 1vh; padding-top: 79.0469px"></section></div></main>
			<script>
				const desktop = { 1024: 61.8438, 1280: 72.375, 1440: 79.0469, 1920: 88.8281 };
				const update = () => {
					const width = innerWidth;
					const pad = width < 800
						? width * 0.12 + 37.5
						: width <= 1024 ? desktop[1024]
						: width <= 1280 ? desktop[1024] + (width - 1024) / 256 * (desktop[1280] - desktop[1024])
						: width <= 1440 ? desktop[1280] + (width - 1280) / 160 * (desktop[1440] - desktop[1280])
						: desktop[1440] + (width - 1440) / 480 * (desktop[1920] - desktop[1440]);
					document.getElementById('first-section').style.paddingTop = pad + 'px';
				};
				addEventListener('resize', update);
				update();
			</script>
		` );

		await learnAndApplyFluidGeometry( page, {
			widths: [ 390, 600, 768, 1024, 1280, 1440, 1920 ],
			settleMs: 50,
		} );

		const style = await page.locator( 'style[data-dla-fluid-rules]' ).textContent();
		expect( style ).toContain( '@media (max-width:1023px)' );
		expect( style ).toContain( 'calc(12vw + 37.5px)' );
		expect( style ).toContain( '@media (min-width:1024px) and (max-width:1919px)' );
		expect( style ).toContain( '@media (min-width:1920px)' );
		expect( await page.locator( '#first-section' ).getAttribute( 'data-dla-fluid-segment' ) ).toBeTruthy();
		expect( await page.locator( '#first-section' ).getAttribute( 'style' ) ).not.toContain( 'padding-top' );

		// A late runtime write must not put inline pixels back above the rules.
		await page.setViewportSize( { width: 1000, height: 900 } );
		await page.waitForTimeout( 120 );
		expect( await page.locator( '#first-section' ).getAttribute( 'style' ) ).not.toContain( 'padding-top' );

		// The mobile regime reproduces the source's clearance at 390.
		await page.setViewportSize( { width: 390, height: 900 } );
		await page.waitForTimeout( 80 );
		const mobilePadding = await page
			.locator( '#first-section' )
			.evaluate( ( element ) => parseFloat( getComputedStyle( element ).paddingTop ) );
		expect( Math.abs( mobilePadding - 84.3 ) ).toBeLessThanOrEqual( 1 );

		// The sampled desktop answer stays exact at the capture width.
		await page.setViewportSize( { width: 1440, height: 900 } );
		await page.waitForTimeout( 80 );
		const desktopPadding = await page
			.locator( '#first-section' )
			.evaluate( ( element ) => parseFloat( getComputedStyle( element ).paddingTop ) );
		expect( Math.abs( desktopPadding - 79.0469 ) ).toBeLessThanOrEqual( 1 );
		await page.close();
	}, 20_000 );
} );
