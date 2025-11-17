import { test, expect, Page } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';
import { getUrlWithAutoLogin } from './utils';

/**
 * Closes the WordPress Block Editor welcome guide if it appears.
 * Attempts to close up to 3 times as the modal can appear multiple times.
 */
async function closeWelcomeGuide( page: Page ) {
	// Try to close the modal up to 3 times
	for ( let i = 0; i < 2; i++ ) {
		try {
			// Wait for the modal frame to appear
			const modalFrame = page.locator( '.components-modal__frame' );
			await modalFrame.waitFor( { state: 'visible', timeout: 2000 } );

			// Find and click the close button using specific selector
			const closeButton = page.locator( '.components-modal__header > button[aria-label="Close"]' );
			await closeButton.waitFor( { state: 'visible', timeout: 2000 } );
			await closeButton.click();
		} catch ( e ) {
			// Modal not found or already closed, exit the loop
			break;
		}
	}
}

test.describe( 'Site Navigation', () => {
	const session = new E2ESession();

	const siteName = 'My WordPress Website'; // Use the default site created during onboarding

	let frontendUrl: string;
	let wpAdminUrl: string;

	test.beforeAll( async () => {
		await session.launch();

		// Complete onboarding before tests
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
		await onboarding.continueButton.click();

		const whatsNewModal = new WhatsNewModal( session.mainWindow );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.closeButton.click();
		}

		// Wait for default site to be ready and get URLs
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		// Get site URLs for tests
		const settingsTab = await siteContent.navigateToTab( 'Settings' );
		wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'opens site at homepage', async ( { page } ) => {
		// Navigate to the site homepage
		await page.goto( frontendUrl );

		// Verify the page loaded successfully
		await expect( page ).toHaveURL( frontendUrl );

		// Check for WordPress indicators (body classes, meta tags, etc.)
		const bodyClass = await page.locator( 'body' ).getAttribute( 'class' );
		expect( bodyClass ).toMatch( /wordpress|wp-|home/ );

		// Verify page title exists
		const title = await page.title();
		expect( title ).toBeTruthy();
		expect( title.length ).toBeGreaterThan( 0 );
	} );

	test( 'opens and automatically logs in to WP Admin', async ( { page } ) => {
		// Navigate to wp-admin with auto-login
		await page.goto( getUrlWithAutoLogin( wpAdminUrl ) );

		// Verify we're on the dashboard
		await expect( page ).toHaveURL( /wp-admin/ );

		// Check for dashboard elements
		await expect( page.locator( '#wpadminbar' ) ).toBeVisible();
		await expect( page.locator( '#adminmenuback' ) ).toBeVisible();

		// Verify we're logged in by checking for user menu
		const userMenu = page.locator( '#wp-admin-bar-my-account' );
		await expect( userMenu ).toBeVisible();
	} );

	test( 'creates a post', async ( { page } ) => {
		// Navigate to new post page
		const newPostUrl = `${ wpAdminUrl }/post-new.php`;
		await page.goto( getUrlWithAutoLogin( newPostUrl ) );

		const editorFrame = page.frameLocator( 'iframe[name="editor-canvas"]' );

		// Close welcome guide if it appears (always on main page, not in iframe)
		await closeWelcomeGuide( page );

		// Wait for title to be available in iframe
		const titleSelector = 'h1.editor-post-title';
		await editorFrame.locator( titleSelector ).waitFor( { timeout: 30_000 } );
		await editorFrame.locator( titleSelector ).fill( 'E2E Test Post' );

		// Click into the content area and type
		await editorFrame.locator( titleSelector ).press( 'Enter' );
		const contentBlock = editorFrame.locator( 'p[role="document"]' ).first();
		await contentBlock.fill( 'This is a test post created by automated E2E tests.' );

		// Publish the post (publish buttons are on main page)
		const publishButton = page.locator( 'button.editor-post-publish-button__button' ).first();
		await publishButton.waitFor( { state: 'visible', timeout: 10_000 } );
		await publishButton.click();

		// Wait for and click the confirm publish button in the panel
		const confirmPublishButton = page.locator( 'button.editor-post-publish-button__button' ).last();
		await confirmPublishButton.waitFor( { state: 'visible', timeout: 10_000 } );
		await confirmPublishButton.click();

		// Wait for success message
		await expect( page.locator( '.components-snackbar' ) ).toBeVisible( { timeout: 10_000 } );

		// Verify post was created by visiting posts list
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/edit.php` ) );
		await expect( page.locator( 'a.row-title:has-text("E2E Test Post")' ) ).toBeVisible();
	} );

	test( 'uploads media', async ( { page } ) => {
		// Navigate to media library
		const addNewMediaUrl = `${ wpAdminUrl }/media-new.php`;
		await page.goto( getUrlWithAutoLogin( addNewMediaUrl ) );

		// Create a minimal valid PNG file (1x1 red pixel)
		const pngBuffer = Buffer.from( [
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
			0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
			0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xf8,
			0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x83, 0x75, 0x00, 0x00, 0x00,
			0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
		] );

		const testImagePath = '/tmp/e2e-test-image.png';
		await fs.writeFile( testImagePath, pngBuffer );

		// Upload the file using the HTML5 plupload file input
		// The actual file input is hidden, so we need to set files directly on it
		const fileInputPromise = page.waitForEvent( 'filechooser' );
		await page.locator( '#plupload-browse-button' ).click();
		const fileChooser = await fileInputPromise;
		await fileChooser.setFiles( testImagePath );

		// Wait for upload to complete
		await expect( page.locator( '.media-item .filename' ) ).toBeVisible( { timeout: 30_000 } );

		// Clean up test file
		await fs.unlink( testImagePath );

		// Verify media was uploaded by checking the library
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/upload.php` ) );
		const mediaItems = page.locator( '.attachment' );
		await expect( mediaItems.first() ).toBeVisible();
	} );

} );
