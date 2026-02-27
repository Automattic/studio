import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '@studio/common/lib/fs-utils';
import {
	RecommendedPHPVersion as DEFAULT_PHP_VERSION,
	SupportedPHPVersions as ALLOWED_PHP_VERSIONS,
} from '@studio/common/types/php-versions';
import fs from 'fs-extra';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;

test.describe( 'Servers', () => {
	const session = new E2ESession();

	async function completeOnboardingWithParams(
		customSiteName?: string,
		customFolderName?: string
	) {
		const env: NodeJS.ProcessEnv = {};

		if ( customFolderName ) {
			const fullLocalPath = path.join( session.homePath, 'Studio', customFolderName );
			await fs.mkdir( fullLocalPath, { recursive: true } );
			env.E2E_OPEN_FOLDER_DIALOG = fullLocalPath;
		}
		await session.launch( env );

		const onboarding = new Onboarding( session.mainWindow );
		const { siteName, localPath } = await onboarding.completeOnboarding( {
			customSiteName,
			customFolderName,
		} );

		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		return {
			siteName,
			localPath,
		};
	}

	test.afterEach( async () => {
		await session.cleanup();
	} );

	[
		[ undefined, undefined ],
		[ 'E2E-Test-Site', undefined ],
		[ 'E2E-Test-Site 2', 'hello' ],
	].forEach( ( [ customSiteName, customFolderName ] ) => {
		test( `create site with name ${ customSiteName } and path ${ customFolderName }`, async () => {
			const { siteName, localPath } = await completeOnboardingWithParams(
				customSiteName,
				customFolderName
			);

			// Check the site is running
			const siteContent = new SiteContent( session.mainWindow, siteName );
			await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
			await expect( siteContent.siteNameHeading ).toHaveText( siteName );

			const sidebar = new MainSidebar( session.mainWindow );
			const siteTitle = sidebar.getSiteNavButton( siteName );
			await expect( siteTitle ).toHaveText( siteName );

			// Check a WordPress site has been created
			expect( await pathExists( path.join( localPath, 'wp-config.php' ) ) ).toBe( true );

			await siteContent.navigateToTab( 'Settings' );

			await expect( siteContent.frontendButton ).toBeVisible();
			const frontendUrl = await siteContent.frontendButton.textContent();
			expect( frontendUrl ).not.toBeNull();
			const response = await fetch( `http://${ frontendUrl }` );
			expect( [ 200, 302 ] ).toContain( response.status );
			expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
		} );
	} );

	test( 'change PHP version', async () => {
		await completeOnboardingWithParams();

		const newPhpVersion = ALLOWED_PHP_VERSIONS.find( ( v ) => v !== DEFAULT_PHP_VERSION ) || '8.2';

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		const initialPhpVersion = await settingsTab.phpVersionSelect.inputValue();
		expect( initialPhpVersion ).toBe( DEFAULT_PHP_VERSION );

		await settingsTab.phpVersionSelect.selectOption( newPhpVersion );
		await settingsTab.saveButton.click();
		await expect( settingsTab.editSiteDialog ).not.toBeVisible( { timeout: 120_000 } );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		const updatedPhpVersion = await settingsTab.phpVersionSelect.inputValue();
		expect( updatedPhpVersion ).toBe( newPhpVersion );

		await settingsTab.editSiteDialog.getByRole( 'button', { name: 'Cancel' } ).click();
	} );

	test( 'renames a site', async () => {
		const { siteName } = await completeOnboardingWithParams();

		const newSiteName = 'E2E-Test-Site-Renamed';
		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		await settingsTab.siteNameInput.fill( newSiteName );
		await settingsTab.saveButton.click();
		await expect( settingsTab.editSiteDialog ).not.toBeVisible( { timeout: 20_000 } );

		// Explicitly wait for the rename to propagate
		const renamedSiteContent = new SiteContent( session.mainWindow, newSiteName );
		await expect( renamedSiteContent.siteNameHeading ).toHaveText( newSiteName, {
			timeout: 10000,
		} );
	} );

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		const { siteName } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );

		// page.goto opens a browser
		const optionsGeneralUrl = wpAdminUrl + '/options-general.php';
		await page.goto( getUrlWithAutoLogin( optionsGeneralUrl ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( 'testing site title' );
		await siteTitleInput.press( 'Enter' );

		await page.goto( frontendUrl );
		expect( await page.title() ).toBe( 'testing site title' );
	} );

	skipTestOnWindows( 'delete site but keep directory on disk', async () => {
		const { siteName, localPath } = await completeOnboardingWithParams();

		expect( await pathExists( path.join( localPath, 'wp-config.php' ) ) ).toBe( true );

		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to simulate the user clicking the "Delete site"
		// confirmation button without "Delete site files from my computer" checked.
		// See: https://github.com/microsoft/playwright/issues/21432
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: false };
			};
		} );
		await settingsTab.openDeleteSiteModal();
		await session.mainWindow.waitForTimeout( 1000 );

		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( DEFAULT_SITE_NAME ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( localPath ) ).toBe( true );
	} );

	skipTestOnWindows( 'delete site and remove directory from disk', async () => {
		const { siteName, localPath } = await completeOnboardingWithParams();

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
		await session.mainWindow.waitForTimeout( 1000 );

		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( siteName ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( localPath ) ).toBe( false );
	} );

	test( 'copy site creates a duplicate with all files and thumbnail', async () => {
		const { siteName } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const appDataFile = path.join( session.appDataPath, 'Studio', 'appdata-v1.json' );
		const appData = await fs.readJson( appDataFile );
		const site = appData.sites.find( ( s: { name: string } ) => s.name === siteName );
		const siteId = site.id;

		const thumbnailsDir = path.join( session.appDataPath, 'Studio', 'thumbnails' );
		await fs.ensureDir( thumbnailsDir );
		const sourceThumbnailPath = path.join( thumbnailsDir, `${ siteId }.png` );
		await fs.writeFile( sourceThumbnailPath, 'test-thumbnail-data' );

		// Trigger copy via IPC (bypassing native menu since Playwright can't interact with it)
		await session.electronApp.evaluate(
			( { BrowserWindow }, { siteId } ) => {
				const mainWindow = BrowserWindow.getAllWindows()[ 0 ];
				mainWindow.webContents.send( 'site-context-menu-action', {
					action: 'copy-site',
					siteId,
				} );
			},
			{ siteId }
		);

		const expectedCopyName = `${ siteName } Copy`;
		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( expectedCopyName ) ).toBeVisible( {
			timeout: 120_000,
		} );

		const copiedSiteContent = new SiteContent( session.mainWindow, expectedCopyName );
		await expect( copiedSiteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const updatedAppData = await fs.readJson( appDataFile );
		const copiedSite = updatedAppData.sites.find(
			( s: { name: string } ) => s.name === expectedCopyName
		);
		expect( copiedSite ).toBeDefined();

		expect( await pathExists( path.join( copiedSite.path, 'wp-config.php' ) ) ).toBe( true );

		const copiedThumbnailPath = path.join( thumbnailsDir, `${ copiedSite.id }.png` );
		expect( await pathExists( copiedThumbnailPath ) ).toBe( true );
	} );
} );
