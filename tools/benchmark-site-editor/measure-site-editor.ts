/**
 * Site editor performance measurement module.
 *
 * Runs a single benchmark pass against a WordPress site: launches Chromium,
 * navigates through the site editor, and returns raw timing values for each metric.
 */

import { chromium, type Page, type Frame } from 'playwright';

// ---------------------------------------------------------------------------
// Metric names and types
// ---------------------------------------------------------------------------

export const METRIC_NAMES = [
	'siteEditorLoad',
	'templatesViewLoad',
	'templateOpen',
	'blockAdd',
	'templateSave',
] as const;

export type MetricName = ( typeof METRIC_NAMES )[ number ];

/** A single measurement result: one timing value per metric. A metric may be missing if that step failed. */
export type MeasurementResult = Partial< Record< MetricName, number > >;

export interface MeasureOptions {
	/** The base URL of the WordPress site to benchmark. */
	url: string;
	/** Whether this is a Playground Web URL (playground.wordpress.net). Affects iframe handling. */
	isPlaygroundWeb: boolean;
	/** Whether this is a local Playground CLI site (127.0.0.1). Affects login flow. */
	isPlaygroundCli: boolean;
	/** Whether this is a Local by Flywheel site. Uses wp-login.php credentials. */
	isLocal: boolean;
	/** Launch browser in headed mode for debugging. */
	headed?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUrlWithAutoLogin( destinationUrl: string ): string {
	const parsedUrl = new URL( destinationUrl );
	const baseUrl = `${ parsedUrl.protocol }//${ parsedUrl.hostname }:${ parsedUrl.port }`;
	return `${ baseUrl }/studio-auto-login?redirect_to=${ encodeURIComponent( destinationUrl ) }`;
}

function findWordPressFrame( page: Page ): Frame | null {
	const frames = page.frames();
	let wordPressFrame =
		frames.find( ( frame ) => {
			const url = frame.url();
			return (
				url.includes( 'wordpress' ) ||
				url.includes( 'wp-admin' ) ||
				url.includes( 'wp-login' ) ||
				url.includes( 'scope:' )
			);
		} ) || null;

	if ( ! wordPressFrame ) {
		for ( const frame of page.frames() ) {
			if ( frame.parentFrame() && frame.url().includes( 'scope:' ) ) {
				wordPressFrame = frame;
				break;
			}
		}
	}

	return wordPressFrame;
}

function findEditorCanvasFrame(
	page: Page,
	isPlaygroundWeb: boolean,
	wordPressFrame: Frame | null
): Frame | null {
	if ( isPlaygroundWeb && wordPressFrame ) {
		let frame = wordPressFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null;
		if ( ! frame ) {
			frame = page.frames().find( ( f ) => f.name() === 'editor-canvas' ) || null;
		}
		return frame;
	}
	return page.frame( { name: 'editor-canvas' } );
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Runs a single benchmark measurement pass against the given URL.
 *
 * Launches a fresh Chromium browser, navigates to the site editor,
 * performs the measurement steps, and returns timing results.
 * The browser is always closed, even on error.
 */
export async function measureSiteEditor( options: MeasureOptions ): Promise< MeasurementResult > {
	const { isPlaygroundWeb, isPlaygroundCli, isLocal } = options;

	// Normalize URL
	let wpAdminUrl = options.url;
	if ( ! wpAdminUrl.startsWith( 'http' ) ) {
		wpAdminUrl = `http://${ wpAdminUrl }`;
	}
	wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

	const result: MeasurementResult = {};

	const browser = await chromium.launch( { headless: ! options.headed } );
	const context = await browser.newContext();
	const page = await context.newPage();

	let wordPressFrame: Frame | null = null;
	let wordPressFrameLocator: ReturnType< Page[ 'frameLocator' ] > | null = null;

	try {
		// Navigate to wp-admin (environment-specific)
		if ( isPlaygroundWeb ) {
			await page.goto( wpAdminUrl, { waitUntil: 'networkidle' } );

			wordPressFrameLocator = page
				.frameLocator( 'iframe.playground-viewport' )
				.first()
				.frameLocator( 'iframe' )
				.first();

			await wordPressFrameLocator
				.getByRole( 'link', { name: 'Appearance' } )
				.waitFor( { timeout: 30_000 } );

			wordPressFrame = findWordPressFrame( page );
		} else if ( isPlaygroundCli ) {
			await page.goto( `${ wpAdminUrl }/wp-admin`, {
				waitUntil: 'domcontentloaded',
				timeout: 120_000,
			} );
			await page.waitForLoadState( 'networkidle', { timeout: 30_000 } ).catch( () => {} );
			await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );
		} else if ( isLocal ) {
			// Local sites require wp-login.php with credentials
			await page.goto( `${ wpAdminUrl }/wp-login.php`, {
				waitUntil: 'domcontentloaded',
				timeout: 120_000,
			} );
			await page.waitForLoadState( 'networkidle', { timeout: 30_000 } ).catch( () => {} );
			await page.fill( '#user_login', 'admin' );
			await page.fill( '#user_pass', 'password' );
			await Promise.all( [
				page.waitForURL( '**/wp-admin/**', { timeout: 60_000 } ),
				page.click( '#wp-submit' ),
			] );
			await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );
		} else {
			// Studio: use auto-login endpoint
			await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin` ), {
				waitUntil: 'domcontentloaded',
				timeout: 120_000,
			} );
			await page.waitForLoadState( 'networkidle', { timeout: 30_000 } ).catch( () => {} );
			await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );
		}

		const target = isPlaygroundWeb && wordPressFrameLocator ? wordPressFrameLocator : page;

		// Step 1: Navigate to site editor
		const siteEditorStart = Date.now();

		await target.getByRole( 'link', { name: 'Appearance' } ).click();
		await target.locator( 'a[href="site-editor.php"]' ).click();

		// Close welcome modal if it appears
		const welcomeDialog = target.getByRole( 'dialog', {
			name: /welcome to the site editor/i,
		} );
		const isModalVisible = await welcomeDialog.isVisible( { timeout: 5_000 } ).catch( () => false );
		if ( isModalVisible ) {
			await target.getByRole( 'button', { name: /get started/i } ).click();
			await welcomeDialog.waitFor( { state: 'hidden', timeout: 5_000 } ).catch( () => {} );
		}

		await target.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
			state: 'visible',
			timeout: 120_000,
		} );

		const frame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );
		if ( ! frame ) {
			throw new Error( 'Editor canvas frame not found' );
		}

		await frame.waitForLoadState( 'domcontentloaded' );
		await frame.waitForSelector( '[data-block]', { timeout: 60_000 } );
		await frame.waitForFunction(
			() => {
				const blocks = document.querySelectorAll( '[data-block]' );
				return (
					blocks.length > 0 && Array.from( blocks ).some( ( block ) => block.clientHeight > 0 )
				);
			},
			{ timeout: 60_000 }
		);

		result.siteEditorLoad = Date.now() - siteEditorStart;

		// Step 2: Navigate to Templates view
		const templatesViewStart = Date.now();

		await target.getByRole( 'button', { name: 'Templates' } ).click();

		await target.getByRole( 'heading', { name: 'Templates', level: 2 } ).waitFor( {
			timeout: 60_000,
		} );
		await target
			.locator( '.dataviews-view-grid-items.dataviews-view-grid' )
			.waitFor( { timeout: 60_000 } );
		const firstCard = target.locator( '.dataviews-view-grid__card' ).first();
		await firstCard.waitFor( { state: 'visible', timeout: 60_000 } );
		await firstCard.getByRole( 'button' ).first().waitFor( { state: 'visible', timeout: 60_000 } );

		result.templatesViewLoad = Date.now() - templatesViewStart;

		// Step 3: Open a template
		const templateOpenStart = Date.now();

		await target
			.locator( '.dataviews-view-grid__card' )
			.first()
			.getByRole( 'button' )
			.first()
			.click();

		await target.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
			state: 'visible',
			timeout: 60_000,
		} );

		const templateFrame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );
		if ( ! templateFrame ) {
			throw new Error( 'Template editor frame not found' );
		}

		await templateFrame.waitForLoadState( 'domcontentloaded' );
		await templateFrame.waitForSelector( '[data-block]', { timeout: 60_000 } );
		await templateFrame.waitForFunction(
			() => {
				const blocks = document.querySelectorAll( '[data-block]' );
				return (
					blocks.length > 0 && Array.from( blocks ).some( ( block ) => block.clientHeight > 0 )
				);
			},
			{ timeout: 60_000 }
		);

		result.templateOpen = Date.now() - templateOpenStart;

		// Step 4: Add blocks
		const blockAddStart = Date.now();

		await page.keyboard.press( 'Escape' );

		await target.getByRole( 'button', { name: /Block Inserter/i } ).click();

		const searchInput = target.getByPlaceholder( 'Search' );
		await searchInput.fill( 'Paragraph' );
		await target.getByRole( 'option', { name: 'Paragraph', exact: true } ).click();
		await templateFrame.waitForSelector( 'p[data-block]', { timeout: 15_000 } );

		await searchInput.fill( 'Heading' );
		await target
			.locator( '.block-editor-block-types-list__item' )
			.filter( { hasText: /^Heading$/ } )
			.click();
		await templateFrame.waitForSelector( 'h1[data-block], h2[data-block], h3[data-block]', {
			timeout: 15_000,
		} );

		result.blockAdd = Date.now() - blockAddStart;

		// Step 5: Save the template
		const templateSaveStart = Date.now();

		await target.getByRole( 'button', { name: 'Save' } ).first().click();

		await page.waitForFunction(
			() => {
				const saveButton = Array.from( document.querySelectorAll( 'button' ) ).find(
					( btn ) =>
						btn.textContent?.includes( 'Saved' ) ||
						btn.getAttribute( 'aria-label' )?.toLowerCase().includes( 'saved' )
				);
				return saveButton !== null;
			},
			{ timeout: 30_000 }
		);

		result.templateSave = Date.now() - templateSaveStart;
	} finally {
		await page.close();
		await context.close();
		await browser.close();
	}

	return result;
}
