import {
	test,
	expect,
	chromium,
	Browser,
	BrowserContext,
	Page,
	Frame,
	FrameLocator,
} from '@playwright/test';
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
	const results: BenchmarkResults[] = [];

	// Get target URL from environment variable (required)
	// Example: BENCHMARK_URL=http://localhost:8888 or BENCHMARK_URL=https://playground.wordpress.net
	const targetUrl = process.env.BENCHMARK_URL;

	// Shared state for the test
	let browser: Browser;
	let context: BrowserContext;
	let page: Page;
	let wordPressFrame: Frame | null = null;
	let wordPressFrameLocator: ReturnType< Page[ 'frameLocator' ] > | null = null;
	let isPlaygroundWeb: boolean;
	let wpAdminUrl: string;

	test.beforeEach( async () => {
		if ( ! targetUrl ) {
			throw new Error(
				'BENCHMARK_URL environment variable is required. Example: BENCHMARK_URL=http://localhost:8888'
			);
		}

		// Parse and normalize the URL
		wpAdminUrl = targetUrl;
		if ( ! wpAdminUrl.startsWith( 'http' ) ) {
			wpAdminUrl = `http://${ wpAdminUrl }`;
		}
		wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

		isPlaygroundWeb = wpAdminUrl.includes( 'playground.wordpress.net' );

		browser = await chromium.launch();
		context = await browser.newContext();
		page = await context.newPage();

		// Environment-specific preparation: Navigate to wp-admin
		if ( isPlaygroundWeb ) {
			// For Playground web: use the URL from environment variable (should be Blueprint URL that starts at wp-admin)
			await page.goto( wpAdminUrl, { waitUntil: 'networkidle' } );

			// Get WordPress frame locator using playground-viewport classname (more stable)
			// The playground-viewport is the wrapper, WordPress site is in a nested iframe
			wordPressFrameLocator = page
				.frameLocator( 'iframe.playground-viewport' )
				.first()
				.frameLocator( 'iframe' )
				.first();

			// Wait for wp-admin to load by checking for Appearance link (same as Studio)
			await wordPressFrameLocator
				.getByRole( 'link', { name: 'Appearance' } )
				.waitFor( { timeout: 30_000 } );

			// Get the actual frame object for use in test body
			wordPressFrame = findWordPressFrame( page );
		} else {
			// For Studio/regular WordPress: navigate directly to wp-admin
			await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin` ), {
				waitUntil: 'networkidle',
			} );
			// Wait for wp-admin to be ready - use Appearance link (same as Playground)
			await page.getByRole( 'link', { name: 'Appearance' } ).waitFor( { timeout: 30_000 } );
		}
	} );

	test.afterEach( async () => {
		await page.close();
		await context.close();
		await browser.close();
	} );

	test.afterAll( async ( {}, testInfo ) => {
		// Calculate summary with flattened metric names (URL included in metric name for multi-environment support)
		const summary: Record< string, number > = {};

		results.forEach( ( result ) => {
			const urlKey = result.url || 'unknown';
			// Create a short identifier from the URL (e.g., "localhost:8888" or "playground-web")
			const urlIdentifier = urlKey.includes( 'playground.wordpress.net' )
				? 'playground-web'
				: urlKey
						.replace( /^https?:\/\//, '' )
						.replace( /\/$/, '' )
						.replace( /[^a-z0-9]/gi, '-' );

			Object.entries( result.metrics ).forEach( ( [ key, value ] ) => {
				if ( value !== undefined ) {
					const metricKey = `${ urlIdentifier }-${ key }`;
					if ( ! summary[ metricKey ] ) {
						summary[ metricKey ] = value;
					} else {
						// If multiple runs, calculate median
						summary[ metricKey ] = median( [ summary[ metricKey ], value ] ) || value;
					}
				}
			} );
		} );

		// Attach results in the format expected by the performance reporter
		await testInfo.attach( 'results', {
			body: JSON.stringify( summary, null, 2 ),
			contentType: 'application/json',
		} );

		// Also attach full results for detailed analysis
		await testInfo.attach( 'benchmark-results-full', {
			body: JSON.stringify( results, null, 2 ),
			contentType: 'application/json',
		} );
	} );

	test( 'benchmark site editor performance', async () => {
		const currentResults: BenchmarkResults = {
			url: wpAdminUrl,
			metrics: {},
		};

		// Get the target for interactions (page or frame locator)
		// Frame locator is already set up in beforeEach
		const target = isPlaygroundWeb && wordPressFrameLocator ? wordPressFrameLocator : page;

		try {
			// wp-admin is already loaded in beforeEach, verified by Appearance link
			// Step 1: Navigate to site editor from wp-admin using Appearance > Editor
			const siteEditorStartTime = Date.now();

			// Click Appearance menu
			await target.getByRole( 'link', { name: 'Appearance' } ).click();
			// Click Editor submenu - use href to be specific (site-editor.php is the site editor)
			await target.locator( 'a[href="site-editor.php"]' ).click();

			// Close welcome modal if it appears
			const welcomeDialog = target.getByRole( 'dialog', { name: /welcome to the site editor/i } );
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
			await frame.waitForSelector( '[data-block]', { timeout: 60_000 } );

			// Wait for blocks to be loaded and spinners to disappear
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

			// Step 3: Navigate to Templates view using command palette
			const templatesViewStartTime = Date.now();

			// Open command palette with keyboard shortcut (works universally)
			await page.keyboard.press( 'Meta+k' );

			// Type "Templates" and select it
			await target.getByRole( 'combobox', { name: /search commands/i } ).fill( 'Templates' );
			await target.getByRole( 'option', { name: /go to: templates/i } ).click();

			// Wait for Templates view to load
			await target.getByRole( 'heading', { name: 'Templates', level: 2 } ).waitFor( {
				timeout: 60_000,
			} );
			await target
				.locator( '.dataviews-view-grid-items.dataviews-view-grid' )
				.waitFor( { timeout: 60_000 } );
			await target.locator( '.dataviews-view-grid__card' ).first().waitFor( { timeout: 60_000 } );

			// Wait for loading spinners to disappear
			if ( isPlaygroundWeb && wordPressFrame ) {
				await wordPressFrame.waitForFunction(
					() => {
						return (
							! document.querySelector( '.components-spinner' ) &&
							! document.querySelector( '.is-loading' ) &&
							! document.querySelector( '[class*="spinner"]' )
						);
					},
					{ timeout: 60_000 }
				);
			} else {
				await page.waitForFunction(
					() => {
						return (
							! document.querySelector( '.components-spinner' ) &&
							! document.querySelector( '.is-loading' ) &&
							! document.querySelector( '[class*="spinner"]' )
						);
					},
					{ timeout: 60_000 }
				);
			}

			const templatesViewEndTime = Date.now();
			currentResults.metrics.templatesViewLoad = templatesViewEndTime - templatesViewStartTime;

			// Step 4: Open a template
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
			await templateFrame.waitForSelector( '[data-block]', { timeout: 60_000 } );
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

			// Step 5: Add blocks
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
			currentResults.metrics.blockAdd = blockAddEndTime - blockAddStartTime;

			// Step 6: Save the template
			const templateSaveStartTime = Date.now();

			await target.getByRole( 'button', { name: 'Save' } ).first().click();

			// Wait for save confirmation - button text changes to "Saved"
			if ( isPlaygroundWeb && wordPressFrame ) {
				await wordPressFrame.waitForFunction(
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
			} else {
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
			}

			const templateSaveEndTime = Date.now();
			currentResults.metrics.templateSave = templateSaveEndTime - templateSaveStartTime;

			results.push( currentResults );
		} catch ( error ) {
			// Save partial results if test fails
			if ( Object.keys( currentResults.metrics ).length > 0 ) {
				results.push( currentResults );
			}
			throw error;
		}
	} );
} );
