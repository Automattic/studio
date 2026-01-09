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

async function closeModalOverlay(
	page: Page,
	frameLocator: FrameLocator | null,
	timeout: number = 5_000
): Promise< void > {
	if ( ! frameLocator ) {
		return;
	}

	const modalOverlay = frameLocator.locator( '.components-modal__screen-overlay' );
	const isOverlayVisible = await modalOverlay.isVisible( { timeout: 2_000 } ).catch( () => false );

	if ( isOverlayVisible ) {
		await page.keyboard.press( 'Escape' );
		await page.waitForTimeout( 500 );
		await modalOverlay.waitFor( { state: 'hidden', timeout } ).catch( () => {} );
		await page.waitForTimeout( 500 );
	}
}

async function closeWelcomeModalFrameLocator(
	page: Page,
	frameLocator: FrameLocator
): Promise< void > {
	const welcomeDialog = frameLocator.getByRole( 'dialog', { name: /welcome to the site editor/i } );
	const isModalVisible = await welcomeDialog.isVisible( { timeout: 5_000 } ).catch( () => false );

	if ( isModalVisible ) {
		// Click the "Get started" button to close the modal
		const getStartedButton = frameLocator.getByRole( 'button', { name: /get started/i } );
		await getStartedButton.click( { timeout: 5_000 } );
		// Wait for the modal to disappear
		await welcomeDialog.waitFor( { state: 'hidden', timeout: 5_000 } ).catch( () => {} );
		// Also wait for the modal overlay to disappear
		const modalOverlay = frameLocator.locator( '.components-modal__screen-overlay' );
		await modalOverlay.waitFor( { state: 'hidden', timeout: 5_000 } ).catch( () => {} );
		await page.waitForTimeout( 1000 );
	} else {
		// Even if the dialog isn't visible, check for and close any modal overlay
		await closeModalOverlay( page, frameLocator );
	}
}

async function closeWelcomeModalPage( page: Page ): Promise< void > {
	const welcomeDialog = page.getByRole( 'dialog', { name: /welcome to the site editor/i } );
	const isModalVisible = await welcomeDialog.isVisible( { timeout: 5_000 } ).catch( () => false );

	if ( isModalVisible ) {
		// Click the "Get started" button to close the modal
		const getStartedButton = page.getByRole( 'button', { name: /get started/i } );
		await getStartedButton.click( { timeout: 5_000 } );
		// Wait for the modal to disappear
		await welcomeDialog.waitFor( { state: 'hidden', timeout: 5_000 } ).catch( () => {} );
		await page.waitForTimeout( 500 );
	}
}

async function waitForFunction(
	page: Page,
	target: Page | FrameLocator,
	isPlaygroundWeb: boolean,
	wordPressFrame: Frame | null,
	fn: () => boolean,
	options: { timeout?: number } = {}
): Promise< void > {
	if ( isPlaygroundWeb && wordPressFrame ) {
		// Use the frame object for waitForFunction
		await wordPressFrame.waitForFunction( fn, options );
	} else {
		// For Page, use waitForFunction directly
		await ( target as Page ).waitForFunction( fn, options );
	}
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
				// First, ensure any modal overlays are closed
				await closeModalOverlay( page, frameLocator );
				// Try to click the "Pages · Template" button to open command palette
				// If that fails, try using keyboard shortcut or finding by heading
				const pagesTemplateButton = frameLocator
					.locator( 'button' )
					.filter( { hasText: /Pages/ } )
					.filter( { hasText: /Template/ } )
					.first();
				const buttonVisible = await pagesTemplateButton
					.isVisible( { timeout: 5_000 } )
					.catch( () => false );
				if ( buttonVisible ) {
					await pagesTemplateButton.click( { timeout: 15_000 } );
				} else {
					// Fallback: try keyboard shortcut (Cmd+K or Meta+K)
					await page.keyboard.press( 'Meta+k' );
					await page.waitForTimeout( 500 );
				}
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
				wordPressFrame = findWordPressFrame( page );

				if ( ! wordPressFrame ) {
					throw new Error( 'Could not find Playground WordPress iframe' );
				}

				await wordPressFrame.waitForLoadState( 'networkidle' );

				// Navigate to site editor using UI
				await navigateToSiteEditor();

				// Close welcome modal if it appears
				if ( wordPressFrameLocator ) {
					await closeWelcomeModalFrameLocator( page, wordPressFrameLocator );
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

				// Close welcome modal if it appears (for regular WordPress sites)
				await closeWelcomeModalPage( page );
			}
			// For Playground web, we're already in the site editor after Step 1

			// Get the target for interactions (used throughout the test)
			const targetForInteraction = getTargetForInteraction();

			// Wait for the editor iframe to appear
			// Use locator() which works for both Page and FrameLocator
			await targetForInteraction.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
				state: 'visible',
				timeout: 120_000,
			} );

			// Wait a bit for the frame to be fully initialized
			await page.waitForTimeout( 1000 );

			// Find the editor canvas frame
			const frame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );

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

			// Wait a bit for the site editor to be fully ready before navigating
			await page.waitForTimeout( 1000 );

			// Ensure any modal overlays are closed before navigating
			await closeModalOverlay( page, wordPressFrameLocator );

			// Navigate to Templates view using UI (unified for all environments)
			await navigateToTemplatesView();

			// Wait for the page to be ready - look for the Templates heading first (it's an h2)
			await targetForInteraction.locator( 'h2:has-text("Templates")' ).waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );

			// Wait for templates grid to load - the templates are displayed in a dataviews grid
			await targetForInteraction
				.locator( '.dataviews-view-grid-items.dataviews-view-grid' )
				.waitFor( {
					state: 'visible',
					timeout: 60_000,
				} );

			// Wait for template cards to be visible in the grid
			await targetForInteraction.locator( '.dataviews-view-grid__card' ).first().waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );

			// Wait for any loading spinners to disappear
			await waitForFunction(
				page,
				targetForInteraction,
				isPlaygroundWeb,
				wordPressFrame,
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
			await targetForInteraction
				.locator( '.dataviews-view-grid__card:first-child .dataviews-view-grid__title-field' )
				.click( { timeout: 30_000 } );

			// Wait for the template editor to load
			await targetForInteraction.locator( 'iframe[name="editor-canvas"]' ).waitFor( {
				state: 'visible',
				timeout: 60_000,
			} );

			// Wait a bit for the frame to be fully initialized
			await page.waitForTimeout( 1000 );

			// Find the template editor canvas frame
			const templateFrame = findEditorCanvasFrame( page, isPlaygroundWeb, wordPressFrame );

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
			await page.waitForTimeout( 300 );

			// Also check if there's a close button and click it
			const closeButton = targetForInteraction.locator(
				'.components-modal__header button[aria-label*="Close"], .components-modal__header button[aria-label*="close"], button.components-modal__header-button'
			);
			const isVisible = await closeButton.isVisible().catch( () => false );
			if ( isVisible ) {
				await closeButton
					.first()
					.click( { timeout: 2_000 } )
					.catch( () => {} );
				await page.waitForTimeout( 300 );
			}

			// Click the inserter button in the top bar (main page, not iframe)
			await targetForInteraction.locator( 'button[aria-label*="Block Inserter"]' ).click( {
				timeout: 10_000,
			} );

			// Wait for block inserter panel to appear in the main page
			const searchInput = targetForInteraction.locator( 'input[placeholder="Search"]' );
			await searchInput.waitFor( {
				state: 'visible',
				timeout: 10_000,
			} );

			// Search for and insert a paragraph block
			await searchInput.fill( 'paragraph' );
			await page.waitForTimeout( 1000 ); // Wait for search results

			// Click on the paragraph block option (in the main page)
			// Use locator with first() to select the first Paragraph option (not Stretchy Paragraph)
			await targetForInteraction
				.locator( 'button[role="option"]' )
				.filter( { hasText: /^Paragraph$/ } )
				.first()
				.click( { timeout: 10_000 } );

			// Wait for block to be inserted in the iframe
			await templateFrame.waitForSelector( 'p[data-block]', {
				timeout: 15_000,
			} );

			// Wait a bit for the block to be fully rendered
			await templateFrame.waitForTimeout( 500 );

			// Add a second block - heading
			// The inserter might still be open, but if not, click the inserter button again
			// First check if inserter is already open, if not, open it
			const inserterOpen = await targetForInteraction
				.locator( 'input[placeholder="Search"]' )
				.isVisible()
				.catch( () => false );

			if ( ! inserterOpen ) {
				await targetForInteraction.locator( 'button[aria-label*="Block Inserter"]' ).click( {
					timeout: 10_000,
				} );
			}

			const searchInput2 = targetForInteraction.locator( 'input[placeholder="Search"]' );
			await searchInput2.waitFor( {
				state: 'visible',
				timeout: 10_000,
			} );
			await searchInput2.fill( 'heading' );
			await page.waitForTimeout( 1000 );

			// Use locator with first() to select the first Heading option (not Stretchy Heading)
			await targetForInteraction
				.locator( 'button[role="option"]' )
				.filter( { hasText: /^Heading$/ } )
				.first()
				.click( { timeout: 10_000 } );

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
			await targetForInteraction.locator( 'button:has-text("Save")' ).first().click( {
				timeout: 30_000,
			} );

			// Wait for save confirmation
			// The save button text changes to "Saved" or a snackbar appears
			await waitForFunction(
				page,
				targetForInteraction,
				isPlaygroundWeb,
				wordPressFrame,
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
