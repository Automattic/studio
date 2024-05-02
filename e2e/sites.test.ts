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
	const defaultOnboardingSiteName = 'My WordPress Website';
	const onboardingTmpSiteDir = `${ tmpdir() }/${ defaultOnboardingSiteName.replace( /\s/g, '-' ) }`;

	test.beforeAll( async () => {
		expect( await pathExists( tmpSiteDir ) ).toBe( false );
		await fs.mkdir( tmpSiteDir, { recursive: true } );

		// Especially in CI systems, the app will start with no sites.
		// Hence, we'll see the onboarding screen.
		// If that's the case, create a new site first to get the onboarding out of the way and enable the tests to proceed.
		//
		// FIXME: Add check to see if the onboarding screen is visible to run E2E tests locally without requiring no sites.
		expect( await pathExists( onboardingTmpSiteDir ) ).toBe( false );
		await fs.mkdir( onboardingTmpSiteDir, { recursive: true } );

		let onboardingAppInstance: ElectronApplication;
		let onboardingMainWindow: Page;
		[ onboardingAppInstance, onboardingMainWindow ] = await launchApp( {
			E2E_OPEN_FOLDER_DIALOG: onboardingTmpSiteDir,
		} );

		const onboarding = new Onboarding( onboardingMainWindow );
		await expect( onboarding.siteNameInput ).toHaveValue( defaultOnboardingSiteName );
		await expect( onboarding.sitePathInput ).toBeVisible();
		await expect( onboarding.continueButton ).toBeVisible();

		await onboarding.clickLocalPathButtonAndSelectFromEnv();
		await onboarding.continueButton.click();

		const siteContent = new SiteContent( onboardingMainWindow, defaultOnboardingSiteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 30_000 } );

		await onboardingAppInstance.close();

		// Reluanch the app but configured to use tmpSiteDir as the path for the local site.
		[ electronApp, mainWindow ] = await launchApp( { E2E_OPEN_FOLDER_DIALOG: tmpSiteDir } );
	} );

	test.afterAll( async () => {
		await electronApp?.close();

		[tmpSiteDir, onboardingTmpSiteDir].forEach(async (dir) => {
			// Check if path exists first, because tmpSiteDir should have been deleted by the test that deletes the site.
			if (await pathExists(dir)) {
				try {
					await fs.rm(dir, { recursive: true });
				} catch {
					// fail test because we couldn't clean up
					fail(`Failed to clean up ${dir}`);
				}
			}
		});
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
		await expect( sidebarButton ).toBeAttached( { timeout: 30_000 } );

		// Check a WordPress site has been created
		expect( await pathExists( path.join( tmpSiteDir, 'wp-config.php' ) ) ).toBe( true );

		// Check the site is running
		const siteContent = new SiteContent( mainWindow, siteName );

		await siteContent.navigateToTab( 'Settings' );

		// expect( await siteContent.locator.getByLabel( 'Copy site url', { exact: false } ) ).toBeVisible();
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
