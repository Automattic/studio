import { test, expect, chromium, Browser, BrowserContext, Page, Frame } from '@playwright/test';
import { getUrlWithAutoLogin } from '../../e2e/utils';
import { median } from '../utils';

interface BenchmarkResults {
	url: string;
	metrics: {
		wpAdminLoad?: number;
		siteEditorLoad?: number;
		templatesViewLoad?: number;
		templateOpen?: number;
		blockAdd?: number;
		templateSave?: number;
	};
}

test.describe( 'Site Editor Performance Benchmark', () => {
	const results: BenchmarkResults[] = [];

	// Get target URL from environment variable (required)
	// Example: BENCHMARK_URL=http://localhost:8888 or BENCHMARK_URL=https://playground.wordpress.net
	const targetUrl = process.env.BENCHMARK_URL;

	test.afterAll( async ( {}, testInfo ) => {
		// Attach results as JSON
		await testInfo.attach( 'benchmark-results', {
			body: JSON.stringify( results, null, 2 ),
			contentType: 'application/json',
		} );

		// Calculate and attach summary
		const summary: Record< string, Record< string, number > > = {};
		results.forEach( ( result ) => {
			const urlKey = result.url || 'unknown';
			if ( ! summary[ urlKey ] ) {
				summary[ urlKey ] = {};
			}
			Object.entries( result.metrics ).forEach( ( [ key, value ] ) => {
				if ( value !== undefined ) {
					if ( ! summary[ urlKey ][ key ] ) {
						summary[ urlKey ][ key ] = value;
					} else {
						// If multiple runs, calculate median
						summary[ urlKey ][ key ] = median( [ summary[ urlKey ][ key ], value ] ) || value;
					}
				}
			} );
		} );

		await testInfo.attach( 'benchmark-summary', {
			body: JSON.stringify( summary, null, 2 ),
			contentType: 'application/json',
		} );
	} );

	test( 'benchmark site editor performance', async () => {
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
		// Remove trailing slash
		wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

		const browser = await chromium.launch();
		const context = await browser.newContext();
		const page = await context.newPage();

		const currentResults: BenchmarkResults = {
			url: wpAdminUrl,
			metrics: {},
		};

		// Check if this is playground.wordpress.net (runs in iframe)
		const isPlaygroundWeb = wpAdminUrl.includes( 'playground.wordpress.net' );
		let playgroundFrame: Frame | null = null;

		try {
			// Step 1: Open wp-admin with auto-login
			const wpAdminStartTime = Date.now();

			if ( isPlaygroundWeb ) {
				// For web Playground, navigate to the main page first
				// Playground runs WordPress in an iframe, so we need to access it through the iframe
				await page.goto( wpAdminUrl, { waitUntil: 'networkidle' } );

				// Wait for the Playground iframe to load - it might take a moment
				await page.waitForTimeout( 2000 );

				// Find the Playground iframe - it's usually the main iframe on the page
				const frames = page.frames();
				playgroundFrame =
					frames.find( ( frame ) => {
						const url = frame.url();
						// The Playground iframe typically contains WordPress
						return (
							url.includes( 'wordpress' ) ||
							url.includes( 'wp-admin' ) ||
							url.includes( 'wp-login' )
						);
					} ) || null;

				if ( ! playgroundFrame ) {
					// Try finding by selector
					const iframeHandle = await page.waitForSelector( 'iframe', { timeout: 10_000 } );
					if ( iframeHandle ) {
						const frameName =
							( await iframeHandle.getAttribute( 'name' ) ) ||
							( await iframeHandle.getAttribute( 'id' ) );
						if ( frameName ) {
							playgroundFrame = page.frame( { name: frameName } );
						} else {
							// Get the first iframe
							playgroundFrame = frames[ 1 ] || null; // frames[0] is usually the main page
						}
					}
				}

				if ( ! playgroundFrame ) {
					throw new Error( 'Could not find Playground iframe' );
				}

				// Wait for the iframe to be ready
				await playgroundFrame.waitForLoadState( 'networkidle' );

				// Navigate within the iframe to wp-admin with auto-login
				const frameUrl = playgroundFrame.url();
				const frameBaseUrl = frameUrl.split( '?' )[ 0 ].split( '#' )[ 0 ].replace( /\/$/, '' );
				await playgroundFrame.goto( getUrlWithAutoLogin( `${ frameBaseUrl }/wp-admin` ), {
					waitUntil: 'networkidle',
				} );
			} else {
				// For regular WordPress installations, navigate directly
				await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin` ), {
					waitUntil: 'networkidle',
				} );
			}

			const wpAdminEndTime = Date.now();
			currentResults.metrics.wpAdminLoad = wpAdminEndTime - wpAdminStartTime;

			// Step 2: Navigate to site editor and wait for it to load completely
			const siteEditorStartTime = Date.now();

			// Use the appropriate page/frame based on whether we're in Playground
			const targetPageOrFrame: Page | Frame =
				isPlaygroundWeb && playgroundFrame ? playgroundFrame : page;
			const baseUrl =
				isPlaygroundWeb && playgroundFrame
					? playgroundFrame.url().split( '?' )[ 0 ].split( '#' )[ 0 ].replace( /\/$/, '' )
					: wpAdminUrl;

			await targetPageOrFrame.goto( `${ baseUrl }/wp-admin/site-editor.php`, {
				waitUntil: 'commit',
			} );

			// Wait for the editor iframe to appear
			await targetPageOrFrame.waitForSelector( 'iframe[name="editor-canvas"]', {
				state: 'visible',
				timeout: 120_000,
			} );

			const frame =
				isPlaygroundWeb && playgroundFrame
					? playgroundFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null
					: ( targetPageOrFrame as Page ).frame( { name: 'editor-canvas' } );
			if ( ! frame ) {
				throw new Error( 'Editor canvas frame not found' );
			}

			// Wait for frame to be ready
			await frame.waitForLoadState( 'domcontentloaded' );
			await frame.waitForSelector( '[data-block]', { timeout: 60_000 } );

			// Make sure blocks are loaded and spinners are gone
			await frame.waitForFunction(
				() => {
					return (
						document.querySelectorAll( '[data-block]' ).length > 0 &&
						! document.querySelector( '.components-spinner' ) &&
						! document.querySelector( '.is-loading' ) &&
						! document.querySelector( '.wp-block-editor__loading' )
					);
				},
				{ timeout: 60_000 }
			);

			const siteEditorEndTime = Date.now();
			currentResults.metrics.siteEditorLoad = siteEditorEndTime - siteEditorStartTime;

			// Step 3: Open Templates view and wait for it to load completely
			const templatesViewStartTime = Date.now();
			await targetPageOrFrame.goto( `${ baseUrl }/wp-admin/site-editor.php?path=%2Fwp_template`, {
				waitUntil: 'commit',
			} );

			// Wait for the page to be ready - look for the Templates heading first (it's an h2)
			await targetPageOrFrame.waitForSelector( 'h2:has-text("Templates")', {
				timeout: 60_000,
			} );

			// Wait for templates grid to load - the templates are displayed in a dataviews grid
			await targetPageOrFrame.waitForSelector( '.dataviews-view-grid', {
				timeout: 60_000,
			} );

			// Wait for template cards to be visible in the grid
			await targetPageOrFrame.waitForSelector( '.dataviews-view-grid_card', {
				timeout: 60_000,
			} );

			// Wait for any loading spinners to disappear
			await targetPageOrFrame.waitForFunction(
				() => {
					return (
						! document.querySelector( '.components-spinner' ) &&
						! document.querySelector( '.is-loading' ) &&
						! document.querySelector( '[class*="spinner"]' )
					);
				},
				{ timeout: 60_000 }
			);

			const templatesViewEndTime = Date.now();
			currentResults.metrics.templatesViewLoad = templatesViewEndTime - templatesViewStartTime;

			// Step 4: Open a template
			const templateOpenStartTime = Date.now();

			// Click on the first available template from the dataviews grid
			// The page-templates-preview-field is a reliable selector for template cards
			await targetPageOrFrame.click( '.page-templates-preview-field:first-child', {
				timeout: 30_000,
			} );

			// Wait for the template editor to load
			await targetPageOrFrame.waitForSelector( 'iframe[name="editor-canvas"]', {
				state: 'visible',
				timeout: 60_000,
			} );

			const templateFrame =
				isPlaygroundWeb && playgroundFrame
					? playgroundFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null
					: ( targetPageOrFrame as Page ).frame( { name: 'editor-canvas' } );
			if ( ! templateFrame ) {
				throw new Error( 'Template editor frame not found' );
			}

			// Wait for template editor to be ready
			await templateFrame.waitForLoadState( 'domcontentloaded' );
			await templateFrame.waitForSelector( '[data-block]', { timeout: 60_000 } );

			// Wait for editor to be fully loaded
			await templateFrame.waitForFunction(
				() => {
					return (
						document.querySelectorAll( '[data-block]' ).length > 0 &&
						! document.querySelector( '.components-spinner' ) &&
						! document.querySelector( '.is-loading' )
					);
				},
				{ timeout: 60_000 }
			);

			const templateOpenEndTime = Date.now();
			currentResults.metrics.templateOpen = templateOpenEndTime - templateOpenStartTime;

			// Step 5: Add a couple of blocks
			const blockAddStartTime = Date.now();

			// Click on the editor to ensure focus
			await templateFrame.click( '[data-block]', { timeout: 10_000 } );

			// Wait a bit for focus
			await templateFrame.waitForTimeout( 500 );

			// Click the inserter button to open block inserter
			await templateFrame.click( 'button[aria-label*="Add block"]', { timeout: 10_000 } );

			// Wait for block inserter to appear
			await templateFrame.waitForSelector( '.block-editor-inserter__search input', {
				timeout: 10_000,
			} );

			// Search for and insert a paragraph block
			const searchInput = await templateFrame.waitForSelector(
				'.block-editor-inserter__search input',
				{
					timeout: 10_000,
				}
			);
			await searchInput?.fill( 'paragraph' );
			await templateFrame.waitForTimeout( 1000 ); // Wait for search results

			// Click on the paragraph block option
			await templateFrame.click( 'button[role="option"]:has-text("Paragraph")', {
				timeout: 10_000,
			} );

			// Wait for block to be inserted
			await templateFrame.waitForSelector( 'p[data-block]', {
				timeout: 15_000,
			} );

			// Wait a bit for the block to be fully rendered
			await templateFrame.waitForTimeout( 500 );

			// Add a second block - heading
			// Click on an existing block to show the inserter
			await templateFrame.click( '[data-block]:last-child', { timeout: 10_000 } );
			await templateFrame.waitForTimeout( 500 );

			// Click inserter button again
			await templateFrame.click( 'button[aria-label*="Add block"]', { timeout: 10_000 } );

			await templateFrame.waitForSelector( '.block-editor-inserter__search input', {
				timeout: 10_000,
			} );

			const searchInput2 = await templateFrame.waitForSelector(
				'.block-editor-inserter__search input',
				{
					timeout: 10_000,
				}
			);
			await searchInput2?.fill( 'heading' );
			await templateFrame.waitForTimeout( 1000 );

			await templateFrame.click( 'button[role="option"]:has-text("Heading")', { timeout: 10_000 } );

			// Wait for second block to be inserted
			await templateFrame.waitForSelector( 'h1[data-block], h2[data-block], h3[data-block]', {
				timeout: 15_000,
			} );

			const blockAddEndTime = Date.now();
			currentResults.metrics.blockAdd = blockAddEndTime - blockAddStartTime;

			// Step 6: Save the template
			const templateSaveStartTime = Date.now();

			// Find and click the save button (usually in the top bar, outside the iframe)
			// The save button is in the main page, not the iframe
			await targetPageOrFrame.click( 'button:has-text("Save")', {
				timeout: 30_000,
			} );

			// Wait for save confirmation
			// The save button text changes to "Saved" or a snackbar appears
			await targetPageOrFrame.waitForFunction(
				() => {
					// Look for save success indicators
					const saveButton = Array.from( document.querySelectorAll( 'button' ) ).find(
						( btn ) =>
							btn.textContent?.includes( 'Saved' ) ||
							btn.getAttribute( 'aria-label' )?.toLowerCase().includes( 'saved' )
					);
					const snackbar = document.querySelector(
						'.components-snackbar, .notice-success, .components-notice.is-success'
					);
					const savedIndicator = document.querySelector( '[class*="saved"], [class*="Saved"]' );
					return saveButton !== null || snackbar !== null || savedIndicator !== null;
				},
				{ timeout: 30_000 }
			);

			const templateSaveEndTime = Date.now();
			currentResults.metrics.templateSave = templateSaveEndTime - templateSaveStartTime;

			results.push( currentResults );
		} finally {
			// Cleanup
			await page.close();
			await context.close();
			await browser.close();
		}
	} );
} );
