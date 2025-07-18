import { test, expect, chromium } from '@playwright/test';
import { E2ESession } from '../../e2e/e2e-helpers';
import Onboarding from '../../e2e/page-objects/onboarding';
import SiteContent from '../../e2e/page-objects/site-content';
import WhatsNewModal from '../../e2e/page-objects/whats-new-modal';
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
	} );

	test( 'measure site editor load time', async () => {
		let wpAdminUrl = '';
		await session.launch();

		// Setup WordPress site
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
		
		// Wait for store initialization to complete (provider constants loading)
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		
		await onboarding.continueButton.click();

		// Handle the What's New modal if it appears
		const whatsNewModal = new WhatsNewModal( session.mainWindow );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.closeButton.click();
		}

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached();

		// Get the WordPress admin URL from settings
		const settingsTab = await siteContent.navigateToTab( 'Settings' );
		wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		// Remove trailing slash if present
		wpAdminUrl = wpAdminUrl.replace( /\/$/, '' );

		// Initialize the results array
		results.load = [];

		// Launch a separate browser for testing
		const browser = await chromium.launch();
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto( `${ wpAdminUrl }?playground-auto-login=true` );
		await page.waitForLoadState( 'networkidle' );

		for ( let i = 0; i < 5; i++ ) {
			// Start timer just before navigating to the site editor
			const startTime = Date.now();
			await page.goto( `${ wpAdminUrl }/site-editor.php` );

			// First wait for the iframe to appear
			await page.waitForSelector( 'iframe[name="editor-canvas"]' );
			const frame = page.frame( { name: 'editor-canvas' } );
			if ( ! frame ) {
				throw new Error( 'Frame not found' );
			}
			await frame.waitForSelector( '[data-block]' );

			// Make sure blocks are loaded and spinners are gone
			await frame.waitForFunction( () => {
				return (
					document.querySelectorAll( '[data-block]' ).length > 0 &&
					! document.querySelector( '.components-spinner' ) &&
					! document.querySelector( '.is-loading' ) &&
					! document.querySelector( '.wp-block-editor__loading' )
				);
			} );

			const endTime = Date.now();
			const duration = endTime - startTime;
			if ( i !== 0 ) {
				results.load.push( duration );
			}

			// Wait between runs
			await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		}
		await page.close();
		await context.close();
		await browser.close();
	} );
} );
