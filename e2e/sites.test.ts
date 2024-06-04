import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../src/lib/fs-utils';
import { launchApp } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import type { ElectronApplication, Page } from 'playwright';

test.describe( 'Servers', () => {
	let electronApp: ElectronApplication;
	let mainWindow: Page;
	const siteName = `test-site-${ randomUUID() }`;
	const tmpSiteDir = path.join( tmpdir(), siteName );
	const defaultOnboardingSiteName = 'My WordPress Website';
	const onboardingTmpSiteDir = path.join(
		tmpdir(),
		defaultOnboardingSiteName.replace( /\s/g, '-' )
	);

	test.beforeAll( async () => {
		// Print path in error so we can delete it manually if needed.
		expect( await pathExists( tmpSiteDir ), `Path ${ tmpSiteDir } exists.` ).toBe( false );
		await fs.mkdir( tmpSiteDir, { recursive: true } );

		// Temporarily launch the app to complete the onboarding process before
		// interacting with the primary app UI.
		expect(
			await pathExists( onboardingTmpSiteDir ),
			`Path ${ onboardingTmpSiteDir } exists.`
		).toBe( false );
		await fs.mkdir( onboardingTmpSiteDir, { recursive: true } );
		const [ onboardingAppInstance, onboardingMainWindow ] = await launchApp( {
			E2E_OPEN_FOLDER_DIALOG: onboardingTmpSiteDir,
		} );
		const onboarding = new Onboarding( onboardingMainWindow );
		const sidebar = new MainSidebar( onboardingMainWindow );

		// Await UI visibility before proceeding.
		await expect( onboarding.heading.or( sidebar.addSiteButton ) ).toBeVisible();

		// If the onboarding heading is present, there are no existing sites and we
		// must complete the onboarding process.
		if ( await onboarding.heading.isVisible() ) {
			await onboarding.selectLocalPathForTesting();
			await onboarding.continueButton.click();

			const siteContent = new SiteContent( onboardingMainWindow, defaultOnboardingSiteName );
			await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 30_000 } );
		}

		await onboardingAppInstance.close();

		// Relaunch the app but configured to use tmpSiteDir as the path for the local site.
		[ electronApp, mainWindow ] = await launchApp( { E2E_OPEN_FOLDER_DIALOG: tmpSiteDir } );
	} );

	test.afterAll( async () => {
		await electronApp?.close();

		[ tmpSiteDir, onboardingTmpSiteDir ].forEach( async ( dir ) => {
			// Check if path exists first, because tmpSiteDir should have been deleted by the test that deletes the site.
			if ( await pathExists( dir ) ) {
				try {
					await fs.rm( dir, { recursive: true } );
				} catch {
					throw new Error( `Failed to clean up ${ dir }` );
				}
			}
		} );
	} );

	test( 'create a new site', async () => {
		const sidebar = new MainSidebar( mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await modal.siteNameInput.fill( siteName );
		await modal.selectLocalPathForTesting();
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

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to simulate the user clicking the "Delete site"
		// confirmation button with "Delete site files from my computer" checked.
		// See: https://github.com/microsoft/playwright/issues/21432
		await electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: true };
			};
		} );
		await settingsTab.openDeleteSiteModal();

		await mainWindow.waitForTimeout( 200 ); // Short pause for site to delete.

		expect( await pathExists( tmpSiteDir ) ).toBe( false );
		const sidebar = new MainSidebar( mainWindow );
		await expect( sidebar.getSiteNavButton( siteName ) ).not.toBeAttached();
	} );
} );
