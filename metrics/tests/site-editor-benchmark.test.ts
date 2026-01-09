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

		// Check if this is playground.wordpress.net (runs in nested iframes)
		const isPlaygroundWeb = wpAdminUrl.includes( 'playground.wordpress.net' );
		let wordPressFrame: Frame | null = null;
		let wordPressFrameLocator: ReturnType< Page[ 'frameLocator' ] > | null = null;

		// Helper function to get the WordPress frame locator (works for both Playground web and regular WordPress)
		const getWordPressFrameLocator = () => {
			if ( isPlaygroundWeb ) {
				// For Playground web, WordPress is in nested iframes
				return page
					.frameLocator( 'iframe[title*="WordPress Playground wrapper"]' )
					.first()
					.frameLocator( 'iframe[title*="WordPress site"]' )
					.first();
			}
			// For regular WordPress/Studio, we interact directly with the page
			return null;
		};

		// Helper function to get the target for interactions (page or frame locator)
		const getTargetForInteraction = () => {
			if ( isPlaygroundWeb && wordPressFrameLocator ) {
				return wordPressFrameLocator;
			}
			return page;
		};

		// Helper function to navigate to site editor using UI
		const navigateToSiteEditor = async () => {
			if ( isPlaygroundWeb ) {
				const frameLocator = getWordPressFrameLocator();
				if ( ! frameLocator ) {
					throw new Error( 'Could not get WordPress frame locator for Playground web' );
				}
				// For Playground web, click "Edit Site" from toolbar
				await frameLocator
					.getByRole( 'menuitem', { name: 'Edit Site' } )
					.click( { timeout: 15_000 } );
			} else {
				// For Studio/regular WordPress, use command palette or menu
				// Try to find and click "Appearance" > "Editor" or use command palette
				// First, try opening command palette with Cmd+K or the button
				const commandPaletteButton = page
					.locator( 'button[aria-label*="command"], button[aria-label*="Command"]' )
					.or( page.locator( 'button:has-text("⌘K")' ) )
					.first();

				const hasCommandPalette = await commandPaletteButton
					.isVisible( { timeout: 2_000 } )
					.catch( () => false );

				if ( hasCommandPalette ) {
					await commandPaletteButton.click( { timeout: 5_000 } ).catch( () => {} );
					await page.waitForTimeout( 500 );
					await page
						.getByRole( 'combobox', { name: /search commands/i } )
						.fill( 'Site Editor', { timeout: 5_000 } )
						.catch( () => {} );
					await page.waitForTimeout( 1000 );
					await page
						.getByRole( 'option', { name: /site editor/i } )
						.click( { timeout: 10_000 } )
						.catch( () => {} );
				} else {
					// Fallback: navigate via URL
					await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin/site-editor.php` ), {
						waitUntil: 'commit',
					} );
				}
			}

			await page.waitForTimeout( 1000 );
		};

		// Helper function to navigate to Templates view using UI
		const navigateToTemplatesView = async () => {
			// Use command palette for all environments
			if ( isPlaygroundWeb ) {
				const frameLocator = getWordPressFrameLocator();
				if ( ! frameLocator ) {
					throw new Error( 'Could not get WordPress frame locator for Playground web' );
				}
				// Click the "Pages · Template" button to open command palette
				await frameLocator
					.getByRole( 'button' )
					.filter( { hasText: /Pages.*Template/ } )
					.first()
					.click( { timeout: 15_000 } );
			} else {
				// For Studio/regular WordPress, try to find command palette button
				const commandPaletteButton = page
					.locator( 'button[aria-label*="command"], button[aria-label*="Command"]' )
					.or( page.locator( 'button:has-text("⌘K")' ) )
					.or( page.locator( 'button:has-text("Pages")' ) )
					.first();

				const hasButton = await commandPaletteButton
					.isVisible( { timeout: 5_000 } )
					.catch( () => false );

				if ( hasButton ) {
					await commandPaletteButton.click( { timeout: 5_000 } );
				} else {
					// Fallback: use keyboard shortcut
					await page.keyboard.press( 'Meta+k' ).catch( () => {} );
				}
			}

			await page.waitForTimeout( 500 );

			// Type "Templates" in the command palette
			if ( isPlaygroundWeb ) {
				const frameLocator = getWordPressFrameLocator();
				if ( ! frameLocator ) {
					throw new Error( 'Could not get WordPress frame locator for Playground web' );
				}
				await frameLocator
					.getByRole( 'combobox', { name: 'Search commands and settings' } )
					.fill( 'Templates', { timeout: 5_000 } );
				await page.waitForTimeout( 1000 );
				await frameLocator
					.getByRole( 'option', { name: 'Go to: Templates' } )
					.click( { timeout: 10_000 } );
			} else {
				const combobox = page.getByRole( 'combobox', { name: /search commands/i } );
				await combobox.fill( 'Templates', { timeout: 5_000 } );
				await page.waitForTimeout( 1000 );
				await page.getByRole( 'option', { name: /templates/i } ).click( { timeout: 10_000 } );
			}

			await page.waitForTimeout( 1000 );
		};

		try {
			// Step 1: Open wp-admin with auto-login
			const wpAdminStartTime = Date.now();

			if ( isPlaygroundWeb ) {
				// For web Playground, navigate to the main page first
				await page.goto( wpAdminUrl, { waitUntil: 'networkidle' } );
				await page.waitForTimeout( 3000 );

				// Get WordPress frame locator
				wordPressFrameLocator = getWordPressFrameLocator();
				if ( ! wordPressFrameLocator ) {
					throw new Error( 'Could not get WordPress frame locator for Playground web' );
				}
				await wordPressFrameLocator.locator( 'body' ).waitFor( { timeout: 30_000 } );

				// Get the actual frame object
				const frames = page.frames();
				wordPressFrame =
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

				if ( ! wordPressFrame ) {
					throw new Error( 'Could not find Playground WordPress iframe' );
				}

				await wordPressFrame.waitForLoadState( 'networkidle' );

				// Navigate to site editor using UI
				await navigateToSiteEditor();

				// Close welcome modal if it appears
				if ( wordPressFrameLocator ) {
					const getStartedButton = wordPressFrameLocator
						.getByRole( 'button', { name: 'Get started' } )
						.or( wordPressFrameLocator.getByRole( 'button', { name: /get started/i } ) );
					const isModalVisible = await getStartedButton
						.isVisible( { timeout: 2_000 } )
						.catch( () => false );
					if ( isModalVisible ) {
						await getStartedButton.click( { timeout: 2_000 } ).catch( () => {} );
						await page.waitForTimeout( 500 );
					}
				}
			} else {
				// For Studio/regular WordPress, start with auto-login admin URL
				await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/wp-admin` ), {
					waitUntil: 'networkidle',
				} );
			}

			const wpAdminEndTime = Date.now();
			currentResults.metrics.wpAdminLoad = wpAdminEndTime - wpAdminStartTime;

			// Step 2: Navigate to site editor and wait for it to load completely
			const siteEditorStartTime = Date.now();

			// Navigate to site editor using UI (unified for all environments)
			if ( ! isPlaygroundWeb ) {
				// For Studio/regular WordPress, navigate to site editor
				await navigateToSiteEditor();
			}
			// For Playground web, we're already in the site editor after Step 1

			// Determine the target for interactions (page or frame)
			const targetPageOrFrame: Page | Frame =
				isPlaygroundWeb && wordPressFrame ? wordPressFrame : page;

			// Wait for the editor iframe to appear
			await targetPageOrFrame.waitForSelector( 'iframe[name="editor-canvas"]', {
				state: 'visible',
				timeout: 120_000,
			} );

			const frame =
				isPlaygroundWeb && wordPressFrame
					? wordPressFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null
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

			// Navigate to Templates view using UI (unified for all environments)
			await navigateToTemplatesView();

			// Wait for the page to be ready - look for the Templates heading first (it's an h2)
			await targetPageOrFrame.waitForSelector( 'h2:has-text("Templates")', {
				timeout: 60_000,
			} );

			// Wait for templates grid to load - the templates are displayed in a dataviews grid
			await targetPageOrFrame.waitForSelector( '.dataviews-view-grid-items.dataviews-view-grid', {
				timeout: 60_000,
			} );

			// Wait for template cards to be visible in the grid
			await targetPageOrFrame.waitForSelector( '.dataviews-view-grid__card', {
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
			// The clickable title field inside the card is the best selector
			await targetPageOrFrame.click(
				'.dataviews-view-grid__card:first-child .dataviews-view-grid__title-field',
				{
					timeout: 30_000,
				}
			);

			// Wait for the template editor to load
			await targetPageOrFrame.waitForSelector( 'iframe[name="editor-canvas"]', {
				state: 'visible',
				timeout: 60_000,
			} );

			const templateFrame =
				isPlaygroundWeb && wordPressFrame
					? wordPressFrame.childFrames().find( ( f ) => f.name() === 'editor-canvas' ) || null
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

			// Close any modal overlays that might appear when opening a template
			// Try pressing Escape to close any modals (use page.keyboard since it's always a Page)
			await page.keyboard.press( 'Escape' ).catch( () => {} );
			await targetPageOrFrame.waitForTimeout( 300 );

			// Also check if there's a close button and click it
			const closeButton = targetPageOrFrame.locator(
				'.components-modal__header button[aria-label*="Close"], .components-modal__header button[aria-label*="close"], button.components-modal__header-button'
			);
			const isVisible = await closeButton.isVisible().catch( () => false );
			if ( isVisible ) {
				await closeButton
					.first()
					.click( { timeout: 2_000 } )
					.catch( () => {} );
				await targetPageOrFrame.waitForTimeout( 300 );
			}

			// Click the inserter button in the top bar (main page, not iframe)
			await targetPageOrFrame.click( 'button[aria-label*="Block Inserter"]', {
				timeout: 10_000,
			} );

			// Wait for block inserter panel to appear in the main page
			await targetPageOrFrame.waitForSelector( 'input[placeholder="Search"]', {
				timeout: 10_000,
			} );

			// Search for and insert a paragraph block
			const searchInput = await targetPageOrFrame.waitForSelector( 'input[placeholder="Search"]', {
				timeout: 10_000,
			} );
			await searchInput?.fill( 'paragraph' );
			await targetPageOrFrame.waitForTimeout( 1000 ); // Wait for search results

			// Click on the paragraph block option (in the main page)
			await targetPageOrFrame.click( 'button[role="option"]:has-text("Paragraph")', {
				timeout: 10_000,
			} );

			// Wait for block to be inserted in the iframe
			await templateFrame.waitForSelector( 'p[data-block]', {
				timeout: 15_000,
			} );

			// Wait a bit for the block to be fully rendered
			await templateFrame.waitForTimeout( 500 );

			// Add a second block - heading
			// The inserter might still be open, but if not, click the inserter button again
			// First check if inserter is already open, if not, open it
			const inserterOpen = await targetPageOrFrame
				.locator( 'input[placeholder="Search"]' )
				.isVisible()
				.catch( () => false );

			if ( ! inserterOpen ) {
				await targetPageOrFrame.click( 'button[aria-label*="Block Inserter"]', {
					timeout: 10_000,
				} );
			}

			await targetPageOrFrame.waitForSelector( 'input[placeholder="Search"]', {
				timeout: 10_000,
			} );

			const searchInput2 = await targetPageOrFrame.waitForSelector( 'input[placeholder="Search"]', {
				timeout: 10_000,
			} );
			await searchInput2?.fill( 'heading' );
			await targetPageOrFrame.waitForTimeout( 1000 );

			await targetPageOrFrame.click( 'button[role="option"]:has-text("Heading")', {
				timeout: 10_000,
			} );

			// Wait for second block to be inserted in the iframe
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
		} catch ( error ) {
			// Even if the test fails partway through, save the metrics we've collected so far
			// This allows us to see performance data even for incomplete runs
			if ( Object.keys( currentResults.metrics ).length > 0 ) {
				results.push( currentResults );
			}
			throw error;
		} finally {
			// Cleanup
			await page.close();
			await context.close();
			await browser.close();
		}
	} );
} );
