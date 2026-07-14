import path from 'path';
import { test, expect } from '@playwright/test';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

test.describe( 'Blueprints', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Run one site at a time to keep peak memory low on constrained hosts.
		const sidebar = new MainSidebar( session.mainWindow );
		await sidebar.getStopAllButton().click();
		await expect( sidebar.locator.getByText( 'No sites running' ) ).toBeAttached( {
			timeout: 60_000,
		} );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );

		const sidebar = new MainSidebar( session.mainWindow );
		const stopAllButton = sidebar.getStopAllButton();
		if ( await stopAllButton.isVisible().catch( () => false ) ) {
			await stopAllButton.click();
			await expect( sidebar.locator.getByText( 'No sites running' ) ).toBeAttached( {
				timeout: 60_000,
			} );
		}
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'create site with Blueprint that installs a theme', async ( { page } ) => {
		const siteName = 'Blueprint-Theme-Install';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'install-theme.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to get admin URL
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify theme was installed
		const themesUrl = wpAdminUrl + '/themes.php';
		await page.goto( getUrlWithAutoLogin( themesUrl ) );
		await expect( page.locator( '.theme[data-slug="twentytwentytwo"]' ) ).toBeVisible();
	} );

	test( 'create site with Blueprint that activates a theme', async ( { page } ) => {
		const siteName = 'Blueprint-Theme-Activate';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'activate-theme.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to get admin URL
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify theme was activated
		const themesUrl = wpAdminUrl + '/themes.php';
		await page.goto( getUrlWithAutoLogin( themesUrl ) );
		const activeTheme = page.locator( '.theme.active' );
		await expect( activeTheme ).toBeVisible();
		await expect( activeTheme ).toHaveAttribute( 'data-slug', 'twentytwentyone' );
	} );

	test( 'create site with Blueprint that installs a plugin', async ( { page } ) => {
		const siteName = 'Blueprint-Plugin-Install';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'install-plugin.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to get admin URL
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify plugin was installed
		const pluginsUrl = wpAdminUrl + '/plugins.php';
		await page.goto( getUrlWithAutoLogin( pluginsUrl ) );
		await expect( page.locator( 'tr[data-slug="akismet"]' ) ).toBeVisible();
	} );

	test( 'create site with Blueprint that activates a plugin', async ( { page } ) => {
		const siteName = 'Blueprint-Plugin-Activate';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'activate-plugin.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to get admin URL
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify plugin was activated
		const pluginsUrl = wpAdminUrl + '/plugins.php';
		await page.goto( getUrlWithAutoLogin( pluginsUrl ) );
		// Be more specific - look for the active Hello Dolly plugin
		// Use a generous timeout to account for auto-login redirect + page load
		const pluginRow = page.locator( 'tr[data-slug="hello-dolly"].active' );
		await expect( pluginRow ).toBeVisible( { timeout: 60_000 } );
	} );

	test( 'create site with Blueprint that runs PHP code', async ( { page } ) => {
		const siteName = 'Blueprint-PHP-Code';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'run-php-code.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to verify site is accessible
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify the site was created successfully and admin is accessible
		const optionsGeneralUrl = wpAdminUrl + '/options-general.php';
		await page.goto( getUrlWithAutoLogin( optionsGeneralUrl ) );
		await expect( page.getByLabel( 'Site Title' ) ).toBeVisible();

		// Verify the blueprint's landing page works
		await expect( page ).toHaveURL( /options-general\.php/ );
	} );

	test( 'create site with Blueprint that runs WP-CLI commands', async ( { page } ) => {
		const siteName = 'Blueprint-WP-CLI';
		const blueprintPath = path.join( __dirname, 'fixtures', 'blueprints', 'wp-cli-command.json' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select blueprint option
		await expect( modal.blueprintButton ).toBeVisible();
		await modal.blueprintButton.click();

		// Upload blueprint file
		await modal.selectBlueprintFile( blueprintPath );

		// Wait for the create form to appear (file upload navigates directly to it)
		await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for site to be created and running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Navigate to Settings tab to verify site is accessible
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// Verify the site was created successfully and admin is accessible
		const optionsGeneralUrl = wpAdminUrl + '/options-general.php';
		await page.goto( getUrlWithAutoLogin( optionsGeneralUrl ) );
		await expect( page.getByLabel( 'Site Title' ) ).toBeVisible();

		// Verify the blueprint's landing page works
		await expect( page ).toHaveURL( /options-general\.php/ );
	} );
} );
