import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../src/lib/fs-utils';
import { launchApp } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import MainSidebar from './page-objects/main-sidebar';
import SiteContent from './page-objects/site-content';
import type { ElectronApplication, Page } from 'playwright';

test.describe( 'Servers', () => {
	let electronApp: ElectronApplication;
	let mainWindow: Page;
	const siteName = `test-site-${ randomUUID() }`;
	const tmpSiteDir = `${ tmpdir() }/${ siteName }`;

	test.beforeAll( async () => {
		expect( await pathExists( tmpSiteDir ) ).toBe( false );
		await fs.mkdir( tmpSiteDir, { recursive: true } );
		[ electronApp, mainWindow ] = await launchApp( { E2E_OPEN_FOLDER_DIALOG: tmpSiteDir } );
	} );

	test.afterAll( async () => {
		await electronApp?.close();
		try {
			await fs.rm( tmpSiteDir, { recursive: true } );
		} catch {
			// If the folder wasn't ever created, a test assertion will have caught this problem
		}
	} );

	test('onboarding', async () => {
		const onboarding = new Onboarding(mainWindow);
		const siteName = 'My WordPress Website';
		await expect(onboarding.siteNameInput).toHaveValue(siteName);
		await expect(onboarding.sitePathInput).toBeVisible();
		await expect(onboarding.continueButton).toBeVisible();

		await onboarding.clickLocalPathButtonAndSelectFromEnv();
		await onboarding.continueButton.click();
		// expect( await onboarding.siteNameInput.inputValue() ).toBe( 'My WordPress Website' );

		const siteContent = new SiteContent(mainWindow, siteName);

		await expect(siteContent.siteNameHeading).toBeVisible({ timeout: 30_000 });
	  await expect(siteContent.siteNameHeading).toHaveText(siteName);

		// const page = mainWindow;

		// const context = await electronApp.newContext();
		// await page.getByLabel( 'Site name' ).dblclick();
		// await page.getByLabel( 'Site name' ).press( 'Meta+a' );
		// await page.getByLabel( 'Site name' ).fill( 'Test Site ' );
		// await page.getByRole( 'button', { name: 'Continue' } ).click();
		// const page1 = await context.newPage();
		// await page1.goto( 'http://localhost:8881/?studio-hide-adminbar' );
		// await page1.close();
		// await page.getByRole( 'heading', { name: 'Test Site' } ).click();
		// await expect(page.getByRole('heading', { name: 'Test Site' })).toBeVisible();

		// ---------------------
		// await context.close();
		// await browser.close();
	} );

	test( 'create a new site', async () => {
		const sidebar = new MainSidebar( mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await modal.siteNameInput.fill( siteName );
		await modal.clickLocalPathButtonAndSelectFromEnv();
		// Can't get the text out of this yet...
		// expect( await modal.localPathInput.inputValue() ).toBe( tmpSiteDir );
		// expect( await modal.localPathInput ).toHaveText( tmpSiteDir, { useInnerText: true } );
		await modal.addSiteButton.click();

		const sidebarButton = sidebar.getSiteNavButton( siteName );
		await expect( sidebarButton ).toBeAttached({ timeout: 30_000 });

		// Check a WordPress site has been created
		expect( await pathExists( path.join( tmpSiteDir, 'wp-config.php' ) ) ).toBe( true );

		// Check the site is running
		const siteContent = new SiteContent( mainWindow, siteName );

		await siteContent.navigateToTab( 'Settings' );

		// expect( await siteContent.locator.getByLabel( 'Copy site url', { exact: false } ) ).toBeVisible();
		expect( await siteContent.frontendButton ).toBeVisible();
		const frontendUrl = await siteContent.frontendButton.textContent();
		expect(frontendUrl).not.toBeNull();
		const response = await new Promise< http.IncomingMessage >( ( resolve, reject ) => {
			http.get( `http://${ frontendUrl }`, resolve ).on( 'error', reject );
		} );
		expect( response.statusCode ).toBe( 200 );
		expect(response.headers['content-type']).toMatch(/text\/html/);

		/*
		const { electron } = require('playwright');

(async () => {
  const browser = await electron.launch({
    headless: false
  });
  const context = await browser.newContext();
  await page.getByRole('button', { name: 'Add site' }).click();
  await page.getByTestId('select-path-button').click();
  await page.getByRole('button', { name: 'Add site' }).click();
  const page1 = await context.newPage();
  await page1.goto('http://localhost:8884/?studio-hide-adminbar');
  await page1.close();
  await page.getByRole('button', { name: 'My Fresh Website', exact: true }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('cell', { name: 'Local domain' }).click({
    button: 'right'
  });
  await page.getByLabel('localhost:8884, Copy site url').click();

  // ---------------------
  await context.close();
  await browser.close();
})();
*/
	} );

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		const siteContent = new SiteContent( mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( electronApp );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( electronApp );

		// page.goto opens a browser
		await page.goto( wpAdminUrl + '/options-general.php' );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( 'testing site title' );
		await siteTitleInput.press( 'Enter' );

		await page.goto( frontendUrl );
		expect( await page.title() ).toBe( 'testing site title' );
	} );

	test( 'delete site', async () => {
		const siteContent = new SiteContent( mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		const modal = await settingsTab.openDeleteSiteModal();
		await modal.deleteFilesCheckbox.check();
		modal.deleteSiteButton.click();

		await mainWindow.waitForTimeout( 200 ); // Short pause for site to delete.

		expect( await pathExists( tmpSiteDir ) ).toBe( false );
		const sidebar = new MainSidebar( mainWindow );
		await expect( sidebar.getSiteNavButton( siteName ) ).not.toBeAttached();
	} );
} );
