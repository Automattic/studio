import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../src/lib/fs-utils';
import { launchApp } from './e2e-helpers';
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

	test( 'create a new site', async () => {
		const sidebar = new MainSidebar( mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await modal.siteNameInput.fill( siteName );
		await modal.clickLocalPathButtonAndSelectFromEnv();
		expect( await modal.localPathInput.inputValue() ).toBe( tmpSiteDir );
		await modal.addSiteButton.click();

		const sidebarButton = sidebar.getSiteNavButton( siteName );
		await expect( sidebarButton ).toBeAttached();

		// Check a WordPress site has been created
		expect( await pathExists( path.join( tmpSiteDir, 'wp-config.php' ) ) ).toBe( true );

		// Check the site is running
		const siteContent = new SiteContent( mainWindow, siteName );
		const frontendUrl = await siteContent.frontendButton.textContent();
		expect( frontendUrl ).toBeTruthy();
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
