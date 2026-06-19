import * as os from 'os';
import * as path from 'path';
import { test, expect, Page } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';
import { getUrlWithAutoLogin } from './utils';

/**
 * Closes the WordPress Block Editor welcome guide if it appears.
 */
async function closeWelcomeGuide( page: Page ) {
	const modalOverlay = page.locator( '.components-modal__screen-overlay' );
	const closeButton = page.locator( '.components-modal__header > button[aria-label="Close"]' );

	for ( let i = 0; i < 3; i++ ) {
		try {
			await modalOverlay.waitFor( { state: 'visible', timeout: 2000 } );
			await closeButton.waitFor( { state: 'visible', timeout: 2000 } );
			await closeButton.click();
			await modalOverlay.waitFor( { state: 'hidden', timeout: 2000 } );
		} catch {
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
		await onboarding.completeOnboarding();

		const whatsNewModal = new WhatsNewModal( session.mainWindow );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.closeButton.click();
		}

		// Wait for default site to be ready and get URLs
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		// Get site URLs for tests
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
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
		const titleSelector = 'h1.editor-post-title__input';
		await expect( editorFrame.locator( titleSelector ) ).toBeVisible( { timeout: 10_000 } );
		await editorFrame.locator( titleSelector ).fill( 'E2E Test Post' );

		// Click into the content area and type
		await editorFrame.locator( titleSelector ).press( 'Enter' );
		const contentBlock = editorFrame.locator( 'p[role="document"]' ).first();
		await contentBlock.fill( 'This is a test post created by automated E2E tests.' );

		// Publish the post (publish buttons are on main page)
		const publishButton = page.locator(
			'button.editor-post-publish-button__button.editor-post-publish-panel__toggle'
		);

		await expect( publishButton ).toBeVisible( { timeout: 10_000 } );
		await closeWelcomeGuide( page );
		await publishButton.click();

		// Wait for and click the confirm publish button in the panel
		const confirmPublishButton = page.locator(
			'.editor-post-publish-panel__header-publish-button button.editor-post-publish-button__button'
		);
		await expect( confirmPublishButton ).toBeVisible( { timeout: 10_000 } );
		await closeWelcomeGuide( page );
		await confirmPublishButton.click();

		// Wait for the "View Post" link to appear
		await expect(
			page.locator( '.post-publish-panel__postpublish-buttons a:has-text("View Post")' )
		).toBeVisible( { timeout: 60_000 } );

		// Verify post was created by visiting posts list
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/edit.php` ) );
		await page.waitForLoadState( 'networkidle' );
		await expect( page.locator( 'a.row-title:has-text("E2E Test Post")' ) ).toBeVisible( {
			timeout: 30_000,
		} );
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

		const testImagePath = path.join( os.tmpdir(), 'e2e-test-image.png' );
		await fs.writeFile( testImagePath, pngBuffer );

		// Upload the file using the HTML5 plupload file input
		// The actual file input is hidden, so we need to set files directly on it
		const fileInputPromise = page.waitForEvent( 'filechooser' );
		await page.locator( '#plupload-browse-button' ).click();
		const fileChooser = await fileInputPromise;
		await fileChooser.setFiles( testImagePath );

		// Wait for upload to complete
		await expect( page.locator( '.media-item .filename' ) ).toBeVisible( { timeout: 30_000 } );

		// Verify media was uploaded by checking the library (force grid mode for consistent selector)
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/upload.php?mode=grid` ) );
		await page.waitForLoadState( 'networkidle' );
		await expect( page.locator( '.attachment' ).first() ).toBeVisible( { timeout: 30_000 } );

		// Clean up test file — don't fail the test if unlink errors
		await fs.unlink( testImagePath ).catch( () => {} );
	} );

	test( 'activates themes', async ( { page } ) => {
		// Navigate to themes page
		const themesUrl = `${ wpAdminUrl }/themes.php`;
		await page.goto( getUrlWithAutoLogin( themesUrl ) );

		// Find a non-active theme
		const inactiveTheme = page.locator( '.theme:not(.active)' ).first();
		await expect( inactiveTheme ).toBeVisible();

		// Get the theme slug before activating
		const themeSlug = await inactiveTheme.getAttribute( 'data-slug' );
		expect( themeSlug ).toBeTruthy();

		// Hover and click activate
		await inactiveTheme.click();
		const activateButton = page.locator( '.inactive-theme > .button.activate' ).first();
		await activateButton.click();

		// Wait for page reload
		await page.waitForLoadState( 'networkidle' );

		// Verify the theme is now active
		const activeTheme = page.locator( `.theme.active[data-slug="${ themeSlug }"]` );
		await expect( activeTheme ).toBeVisible();
	} );

	test( 'adds new themes', async ( { page } ) => {
		// Navigate to themes page
		const themeInstallUrl = `${ wpAdminUrl }/theme-install.php`;
		await page.goto( getUrlWithAutoLogin( themeInstallUrl ) );

		// Search for a theme
		const searchInput = page.locator( '#wp-filter-search-input' );
		await searchInput.fill( 'Twenty Twenty-Two' );
		await searchInput.press( 'Enter' );

		// Wait for search results
		await page.waitForLoadState( 'networkidle' );

		// Find Twenty Twenty-Two theme
		const themeResult = page.locator( '.theme[data-slug="twentytwentytwo"]' ).first();

		// Install the theme
		await themeResult.click();
		const themeInstallOverlay = page.locator( '.theme-install-overlay' );
		await expect( themeInstallOverlay ).toBeVisible( { timeout: 5_000 } );
		const installButton = themeInstallOverlay.locator( 'a.theme-install' );
		await installButton.click();

		// Wait for installation to complete
		await expect( themeInstallOverlay.locator( 'a.activate' ) ).toBeVisible( {
			timeout: 30_000,
		} );
	} );

	test( 'activates plugin', async ( { page } ) => {
		// Navigate to plugins page
		const pluginsUrl = `${ wpAdminUrl }/plugins.php`;
		await page.goto( getUrlWithAutoLogin( pluginsUrl ) );

		// Find an inactive plugin (Hello Dolly is usually installed by default)
		const inactivePlugin = page.locator( 'tr.inactive[data-slug="hello-dolly"]' ).first();
		await expect( inactivePlugin ).toBeVisible();
		const pluginSlug = await inactivePlugin.getAttribute( 'data-slug' );

		// Activate the plugin
		const activateLink = inactivePlugin.locator( 'span.activate a' );
		await activateLink.click();

		// Wait for plugin to be activated
		await page.waitForLoadState( 'networkidle' );

		// Verify plugin is now active
		const activePlugin = page.locator( `tr.active[data-slug="${ pluginSlug }"]` );
		await expect( activePlugin ).toBeVisible();
	} );

	test( 'adds new plugin', async ( { page } ) => {
		// Navigate to plugins page
		const pluginInstallUrl = `${ wpAdminUrl }/plugin-install.php`;
		await page.goto( getUrlWithAutoLogin( pluginInstallUrl ) );

		// Search for a plugin
		const searchInput = page.locator( '#search-plugins' );
		await searchInput.fill( 'Jetpack Protect' );
		await searchInput.press( 'Enter' );

		// Wait for search results
		await page.waitForLoadState( 'networkidle' );

		// Wait for the search spinner to disappear (indicates API response received)
		await expect( page.locator( '.spinner' ) ).toBeHidden( { timeout: 30_000 } );

		// Find Jetpack Protect plugin
		const pluginResult = page.locator( '.plugin-card-jetpack-protect' ).first();
		await expect( pluginResult ).toBeVisible( { timeout: 30_000 } );

		// Install the plugin
		const installButton = pluginResult.locator( 'a.install-now' );
		await installButton.click();

		// Wait for installation to complete
		await page.waitForLoadState( 'networkidle' );

		// Verify plugin was installed
		await expect( pluginResult.locator( 'a.activate-now' ) ).toBeVisible( {
			timeout: 30_000,
		} );
	} );

	test( '"Post name" permalink structure works', async ( { page } ) => {
		// Navigate to permalink settings
		const permalinkUrl = `${ wpAdminUrl }/options-permalink.php`;
		await page.goto( getUrlWithAutoLogin( permalinkUrl ) );

		// Select "Post name" permalink structure
		const postNameRadio = page.locator( 'input#permalink-input-post-name' );
		await postNameRadio.check();

		// Save changes
		const saveButton = page.locator( '#submit' );
		await saveButton.click();

		// Wait for success message
		await expect( page.locator( '#setting-error-settings_updated' ) ).toBeVisible();

		// Verify the setting was saved
		await expect( postNameRadio ).toBeChecked();

		// Create a test post to verify the permalink structure works
		const newPostUrl = `${ wpAdminUrl }/post-new.php`;
		await page.goto( getUrlWithAutoLogin( newPostUrl ) );

		const editorFrame = page.frameLocator( 'iframe[name="editor-canvas"]' );

		// Close welcome guide if it appears (always on main page, not in iframe)
		await closeWelcomeGuide( page );

		// Wait for title to be available in iframe
		const titleSelector = 'h1.editor-post-title__input';
		await expect( editorFrame.locator( titleSelector ) ).toBeVisible( { timeout: 30_000 } );
		await editorFrame.locator( titleSelector ).fill( 'Permalink Test Post' );

		// Click into the content area and type
		await editorFrame.locator( titleSelector ).press( 'Enter' );
		const contentBlock = editorFrame.locator( 'p[role="document"]' ).first();
		await contentBlock.fill( 'Testing permalink structure.' );

		// Publish the post (publish buttons are on main page)
		const publishButton = page.locator(
			'button.editor-post-publish-button__button.editor-post-publish-panel__toggle'
		);

		await expect( publishButton ).toBeVisible( { timeout: 10_000 } );
		await closeWelcomeGuide( page );
		await publishButton.click();

		// Wait for and click the confirm publish button in the panel
		const confirmPublishButton = page.locator(
			'.editor-post-publish-panel__header-publish-button button.editor-post-publish-button__button'
		);
		await expect( confirmPublishButton ).toBeVisible( { timeout: 10_000 } );
		await closeWelcomeGuide( page );
		await confirmPublishButton.click();

		// Wait for the "View Post" link to appear
		await expect(
			page.locator( '.post-publish-panel__postpublish-buttons a:has-text("View Post")' )
		).toBeVisible( { timeout: 60_000 } );

		// Get the post URL from the editor
		const viewPostLink = page.locator( 'a:has-text("View Post")' ).first();
		const postUrl = await viewPostLink.getAttribute( 'href' );

		// Verify the URL follows the post name structure (contains the post slug)
		expect( postUrl ).toMatch( /\/permalink-test-post\/?$/ );

		// Visit the post and verify it loads
		await page.goto( postUrl! );
		await page.waitForLoadState( 'networkidle' );
		await expect( page.locator( 'h1' ) ).toHaveText( 'Permalink Test Post' );
		await expect( page.locator( 'div.entry-content' ) ).toHaveText(
			'Testing permalink structure.'
		);
	} );
} );
