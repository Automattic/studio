import http from 'http';
import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../src/lib/fs-utils';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;

test.describe( 'Servers', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Test-Site';
	const defaultSiteName = 'My WordPress Website';

	test.beforeAll( async () => {
		await session.launch();

		// Complete onboarding before tests
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
		await onboarding.continueButton.click();
		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 60_000 } );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'create a new site', async () => {
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		const sidebarButton = sidebar.getSiteNavButton( siteName );
		await expect( sidebarButton ).toBeAttached( { timeout: 30_000 } );

		// Check a WordPress site has been created
		expect(
			await pathExists( path.join( session.homePath, 'Studio', siteName, 'wp-config.php' ) )
		).toBe( true );

		// Check the site is running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		expect( await siteContent.siteNameHeading ).toHaveText( siteName );

		await siteContent.navigateToTab( 'Settings' );

		expect( await siteContent.frontendButton ).toBeVisible();
		const frontendUrl = await siteContent.frontendButton.textContent();
		expect( frontendUrl ).not.toBeNull();
		const response = await new Promise< http.IncomingMessage >( ( resolve, reject ) => {
			http.get( `http://${ frontendUrl }`, resolve ).on( 'error', reject );
		} );
		expect( response.statusCode ).toBe( 200 );
		expect( response.headers[ 'content-type' ] ).toMatch( /text\/html/ );
	} );

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );

		// page.goto opens a browser
		await page.goto( wpAdminUrl + '/options-general.php' );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( 'testing site title' );
		await siteTitleInput.press( 'Enter' );

		await page.goto( frontendUrl );
		expect( await page.title() ).toBe( 'testing site title' );
	} );

	skipTestOnWindows( 'delete site', async () => {
		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to simulate the user clicking the "Delete site"
		// confirmation button with "Delete site files from my computer" checked.
		// See: https://github.com/microsoft/playwright/issues/21432
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: true };
			};
		} );
		await settingsTab.openDeleteSiteModal();

		await session.mainWindow.waitForTimeout( 200 ); // Short pause for site to delete.

		expect( await pathExists( path.join( session.homePath, 'Studio', siteName ) ) ).toBe( false );
		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( siteName ) ).not.toBeAttached();
	} );
} );
