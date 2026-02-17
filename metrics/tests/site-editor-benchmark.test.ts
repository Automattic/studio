import { test, chromium, Page, Frame } from '@playwright/test';
import { getUrlWithAutoLogin } from '../../e2e/utils';
import { median } from '../utils';

// Helper functions for the benchmark test
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
		// Try searching nested frames
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
		// For Playground web, search in child frames
		let frame = wordPressFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null;
		// If not found, try searching all frames
		if ( ! frame ) {
			const allFrames = page.frames();
			frame = allFrames.find( ( f ) => f.name() === 'editor-canvas' ) || null;
		}
		return frame;
	}
	// For regular WordPress, get the frame from the page
	return page.frame( { name: 'editor-canvas' } );
}

test.describe( 'Site Editor Performance Benchmark', () => {
	// Results collection structure - each metric stores array of values from all runs
	const results: Record< string, number[] > = {
		siteEditorLoad: [],
		templatesViewLoad: [],
		templateOpen: [],
		blockAdd: [],
		templateSave: [],
	};

	// Get configuration from environment variables
	const targetUrl = process.env.BENCHMARK_URL;
	const BENCHMARK_RUNS = parseInt( process.env.BENCHMARK_RUNS || '3', 10 );

	// Environment detection (parsed once, reused for all iterations)
	if ( ! targetUrl ) {
		throw new Error(
			'BENCHMARK_URL environment variable is required. Example: BENCHMARK_URL=http://localhost:8888'
		);
	}

	// Parse and normalize the URL
	let wpAdminUrl = targetUrl;
	if ( ! wpAdminUrl.startsWith( 'http' ) ) {
		wpAdminUrl = `http://${ wpAdminUrl }`;
	}
	wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

	const isPlaygroundWeb = wpAdminUrl.includes( 'playground.wordpress.net' );
	const isLocalPlaygroundCli = wpAdminUrl.includes( '127.0.0.1' );

	// Create URL identifier for metric names
	const urlIdentifier = isPlaygroundWeb
		? 'playground-web'
		: wpAdminUrl
				.replace( /^https?:\/\//, '' )
				.replace( /\/$/, '' )
				.replace( /[^a-z0-9]/gi, '-' );

	test.afterAll( async ( {}, testInfo ) => {
		// Calculate medians using existing utility
		const medians: Record< string, number > = {};
		Object.entries( results ).forEach( ( [ key, values ] ) => {
			if ( values.length > 0 ) {
				const medianValue = median( values );
				if ( medianValue !== undefined ) {
					medians[ `${ urlIdentifier }-${ key }` ] = medianValue;
				}
			}
		} );

		// Attach aggregated results (for performance reporter)
		await testInfo.attach( 'results', {
			body: JSON.stringify( medians, null, 2 ),
			contentType: 'application/json',
		} );

		// Attach detailed results (individual runs + aggregated)
		const detailedResults = {
			url: wpAdminUrl,
			runs: BENCHMARK_RUNS,
			successfulRuns: results.siteEditorLoad.length,
			individual: results,
			medians: medians,
		};

		await testInfo.attach( 'benchmark-results-detailed', {
			body: JSON.stringify( detailedResults, null, 2 ),
			contentType: 'application/json',
		} );
	} );

	test( 'benchmark site editor performance', async () => {
		// Run benchmark N times with fresh browser per iteration
		for ( let run = 1; run <= BENCHMARK_RUNS; run++ ) {
			await test.step( `Run ${ run }/${ BENCHMARK_RUNS }`, async () => {
				// Launch fresh browser for this iteration
				const browser = await chromium.launch();
				const context = await browser.newContext();
				const page = await context.newPage();

				let wordPressFrame: Frame | null = null;
				let wordPressFrameLocator: ReturnType< Page[ 'frameLocator' ] > | null = null;

				try {
					// Environment-specific preparation: Navigate to wp-admin
					if ( isPlaygroundWeb ) {
						// For Playground web: use the URL from environment variable
						await page.goto( wpAdminUrl, { waitUntil: 'networkidle' } );

						// Get WordPress frame locator
						wordPressFrameLocator = page
							.frameLocator( 'iframe.playground-viewport' )
							.first()
							.frameLocator( 'iframe' )
							.first();

						// Wait for wp-admin to load
						await wordPressFrameLocator
							.getByRole( 'link', { name: 'Appearance' } )
							.waitFor( { timeout: 30_000 } );

						// Get the actual frame object
						wordPressFrame = findWordPressFrame( page );
					} else if ( isLocalPlaygroundCli ) {
						// For local Playground CLI: navigate directly to wp-admin
						// Note: Playground CLI may redirect, so we follow redirects
						await page.goto( `${ wpAdminUrl }/wp-admin`, {
							waitUntil: 'domcontentloaded',
							timeout: 120_000,
						} );
						// Wait for page to settle and Appearance link to appear
						await page.waitForLoadState( 'networkidle', { timeout: 30_000 } ).catch( () => {} );
						await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( {
							state: 'visible',
							timeout: 60_000,
						} );
					} else {
						// For Studio: use auto-login endpoint
						await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin` ), {
							waitUntil: 'domcontentloaded',
							timeout: 120_000,
						} );
						// Wait for page to settle and Appearance link to appear
						await page.waitForLoadState( 'networkidle', { timeout: 30_000 } ).catch( () => {} );
						await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( {
							state: 'visible',
							timeout: 60_000,
						} );
					}

					// Get the target for interactions
					const target = isPlaygroundWeb && wordPressFrameLocator ? wordPressFrameLocator : page;

					// Step 1: Navigate to site editor from wp-admin using Appearance > Editor
					const siteEditorStartTime = Date.now();

					// Click Appearance menu
					await target.getByRole( 'link', { name: 'Appearance' } ).click();
					// Click Editor submenu - use href to be specific (site-editor.php is the site editor)
					await target.locator( 'a[href="site-editor.php"]' ).click();

					// Close welcome modal if it appears
					const welcomeDialog = target.getByRole( 'dialog', {
						name: /welcome to the site editor/i,
					} );
					const isModalVisible = await welcomeDialog
						.isVisible( { timeout: 5_000 } )
						.catch( () => false );
					if ( isModalVisible ) {
						await target.getByRole( 'button', { name: /get started/i } ).click();
						await welcomeDialog.waitFor( { state: 'hidden', timeout: 5_000 } ).catch( () => {} );
					}

					// Wait for editor canvas iframe to appear
					await target.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
						state: 'visible',
						timeout: 120_000,
					} );

					// Find the editor canvas frame
					const frame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );
					if ( ! frame ) {
						throw new Error( 'Editor canvas frame not found' );
					}

					// Wait for frame to be ready
					await frame.waitForLoadState( 'domcontentloaded' );
					// Wait for blocks to be present and rendered (positive indicator that editor is ready)
					await frame.waitForSelector( '[data-block]', { timeout: 60_000 } );
					// Ensure at least one block is fully rendered (not just in DOM)
					await frame.waitForFunction(
						() => {
							const blocks = document.querySelectorAll( '[data-block]' );
							return (
								blocks.length > 0 &&
								Array.from( blocks ).some( ( block ) => block.clientHeight > 0 )
							);
						},
						{ timeout: 60_000 }
					);

					const siteEditorEndTime = Date.now();
					results.siteEditorLoad.push( siteEditorEndTime - siteEditorStartTime );

					// Step 2: Navigate to Templates view by clicking Templates button in sidebar
					const templatesViewStartTime = Date.now();

					// Click the Templates button in the sidebar (works across all environments)
					await target.getByRole( 'button', { name: 'Templates' } ).click();

					// Wait for Templates view to load - wait for heading, grid, and ensure first card is clickable
					await target.getByRole( 'heading', { name: 'Templates', level: 2 } ).waitFor( {
						timeout: 60_000,
					} );
					await target
						.locator( '.dataviews-view-grid-items.dataviews-view-grid' )
						.waitFor( { timeout: 60_000 } );
					// Wait for the first template card to be visible and clickable (indicates page is ready)
					const firstCard = target.locator( '.dataviews-view-grid__card' ).first();
					await firstCard.waitFor( { state: 'visible', timeout: 60_000 } );
					await firstCard
						.getByRole( 'button' )
						.first()
						.waitFor( { state: 'visible', timeout: 60_000 } );

					const templatesViewEndTime = Date.now();
					results.templatesViewLoad.push( templatesViewEndTime - templatesViewStartTime );

					// Step 3: Open a template
					const templateOpenStartTime = Date.now();

					// Click on the first template card (it's a button, not a link)
					await target
						.locator( '.dataviews-view-grid__card' )
						.first()
						.getByRole( 'button' )
						.first()
						.click();

					// Wait for template editor to load
					await target.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
						state: 'visible',
						timeout: 60_000,
					} );

					// Find the template editor canvas frame
					const templateFrame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );
					if ( ! templateFrame ) {
						throw new Error( 'Template editor frame not found' );
					}

					// Wait for template editor to be ready
					await templateFrame.waitForLoadState( 'domcontentloaded' );
					// Wait for blocks to be present and rendered (positive indicator that editor is ready)
					await templateFrame.waitForSelector( '[data-block]', { timeout: 60_000 } );
					// Ensure at least one block is fully rendered (not just in DOM)
					await templateFrame.waitForFunction(
						() => {
							const blocks = document.querySelectorAll( '[data-block]' );
							return (
								blocks.length > 0 &&
								Array.from( blocks ).some( ( block ) => block.clientHeight > 0 )
							);
						},
						{ timeout: 60_000 }
					);

					const templateOpenEndTime = Date.now();
					results.templateOpen.push( templateOpenEndTime - templateOpenStartTime );

					// Step 4: Add blocks
					const blockAddStartTime = Date.now();

					// Close any modals
					await page.keyboard.press( 'Escape' );

					// Open block inserter
					await target.getByRole( 'button', { name: /Block Inserter/i } ).click();

					// Search and insert Paragraph block
					const searchInput = target.getByPlaceholder( 'Search' );
					await searchInput.fill( 'Paragraph' );
					await target.getByRole( 'option', { name: 'Paragraph', exact: true } ).click();

					// Wait for paragraph block to appear
					await templateFrame.waitForSelector( 'p[data-block]', { timeout: 15_000 } );

					// Add Heading block
					await searchInput.fill( 'Heading' );
					// Get the block type option (not the pattern) - block types are buttons with class "block-editor-block-types-list__item"
					await target
						.locator( '.block-editor-block-types-list__item' )
						.filter( { hasText: /^Heading$/ } )
						.click();

					// Wait for heading block to appear
					await templateFrame.waitForSelector( 'h1[data-block], h2[data-block], h3[data-block]', {
						timeout: 15_000,
					} );

					const blockAddEndTime = Date.now();
					results.blockAdd.push( blockAddEndTime - blockAddStartTime );

					// Step 5: Save the template
					const templateSaveStartTime = Date.now();

					await target.getByRole( 'button', { name: 'Save' } ).first().click();

					// Wait for save confirmation - button text changes to "Saved"
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

					const templateSaveEndTime = Date.now();
					results.templateSave.push( templateSaveEndTime - templateSaveStartTime );

					console.log( `  ✓ Run ${ run } completed` );
				} finally {
					// Always cleanup browser
					await page.close();
					await context.close();
					await browser.close();
				}

				// Small delay between runs
				if ( run < BENCHMARK_RUNS ) {
					await new Promise( ( resolve ) => setTimeout( resolve, 1000 ) );
				}
			} );
		}
	} );
} );
