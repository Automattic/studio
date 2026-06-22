import { test, expect, chromium } from '@playwright/test';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';
import Onboarding from '../../../apps/studio/e2e/page-objects/onboarding';
import SiteContent from '../../../apps/studio/e2e/page-objects/site-content';
import WhatsNewModal from '../../../apps/studio/e2e/page-objects/whats-new-modal';
import { getUrlWithAutoLogin } from '../../../apps/studio/e2e/utils';
import { median } from '../utils';

test.describe( 'Site Editor Load Metrics', () => {
	const results: Record< string, number[] > = {};
	const siteName = 'Editor-Performance-Test-Site';
	const session = new E2ESession();

	// eslint-disable-next-line no-empty-pattern
	test.afterAll( async ( {}, testInfo ) => {
		const medians = {};

		Object.keys( results ).map( ( metric ) => {
			medians[ metric ] = median( results[ metric ] );
		} );

		await testInfo.attach( 'results', {
			body: JSON.stringify( medians, null, 2 ),
			contentType: 'application/json',
		} );

		await session.cleanup();
		setTimeout( () => process.exit( 0 ), 1000 );
	} );

	test( 'measure site editor load time', async () => {
		let wpAdminUrl = '';
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible( { timeout: 120_000 } );

		// Wait for store initialization to complete (provider constants loading)
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		await onboarding.completeOnboarding( { customSiteName: siteName } );
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, siteName );

		// Site creation can take a while, use explicit timeout matching E2E tests
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Get the WordPress admin URL from settings
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		// Remove trailing slash if present
		wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

		// Initialize the results array
		results.load = [];

		// Launch a separate browser for testing
		const browser = await chromium.launch();
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto( getUrlWithAutoLogin( wpAdminUrl ) );
		await page.waitForLoadState( 'networkidle' );

		// Run 2 iterations: 1 warmup + 1 measurement
		// Outer rounds in CI provide additional samples across full rebuilds
		for ( let i = 0; i < 2; i++ ) {
			// Start timer just before navigating to the site editor
			const startTime = Date.now();
			await page.goto( `${ wpAdminUrl }/site-editor.php`, { waitUntil: 'commit' } );

			// First wait for the iframe to appear with explicit timeout
			await page.waitForSelector( 'iframe[name="editor-canvas"]', {
				state: 'visible',
				timeout: 120_000, // 2 minutes, half of the default action timeout
			} );
			const frame = page.frame( { name: 'editor-canvas' } );
			if ( ! frame ) {
				throw new Error( 'Frame not found' );
			}

			// Wait for frame to be ready before checking for blocks
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

			const endTime = Date.now();
			const duration = endTime - startTime;
			if ( i !== 0 ) {
				results.load.push( duration );
			}

			// Wait longer between runs to let the system settle
			await new Promise( ( resolve ) => setTimeout( resolve, 2000 ) );

			// Navigate away to clear state before next iteration
			if ( i < 1 ) {
				await page.goto( `${ wpAdminUrl }` );
				await page.waitForLoadState( 'networkidle' );
			}
		}
		await page.close();
		await context.close();
		await browser.close();
	} );
} );
