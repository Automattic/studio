import http from 'http';
import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../common/lib/fs-utils';
import { DEFAULT_PHP_VERSION, ALLOWED_PHP_VERSIONS } from '../vendor/wp-now/src/constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';
import { getUrlWithAutoLogin } from './utils';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;

test.describe( 'Servers', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Test-Site';
	const defaultSiteName = 'My WordPress Website';

	const createSite = async ( name: string ) => {
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await expect( modal.createSiteButton ).toBeVisible();
		await modal.createSiteButton.click();

		await modal.siteNameInput.fill( name );
		await modal.addSiteButton.click();

		const siteTitle = sidebar.getSiteNavButton( name );
		await expect( siteTitle ).toHaveText( name );

		const siteContent = new SiteContent( session.mainWindow, name );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		return { sidebar, siteContent };
	};

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

		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'create a new site', async () => {
		const { siteContent } = await createSite( siteName );

		expect( await siteContent.siteNameHeading ).toHaveText( siteName );

		expect(
			await pathExists( path.join( session.homePath, 'Studio', siteName, 'wp-config.php' ) )
		).toBe( true );

		await siteContent.navigateToTab( 'Settings' );

		expect( await siteContent.frontendButton ).toBeVisible();
		const frontendUrl = await siteContent.frontendButton.textContent();
		expect( frontendUrl ).not.toBeNull();
		const response = await new Promise< http.IncomingMessage >( ( resolve, reject ) => {
			http.get( `http://${ frontendUrl }`, resolve ).on( 'error', reject );
		} );
		expect( [ 200, 302 ] ).toContain( response.statusCode );
		expect( response.headers[ 'content-type' ] ).toMatch( /text\/html/ );
	} );

	test( 'change PHP version', async () => {
		const newPhpVersion = ALLOWED_PHP_VERSIONS.find(v => v !== DEFAULT_PHP_VERSION) || '8.2';

		const siteContent = new SiteContent( session.mainWindow, siteName );
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

	test( "edit site's settings in wp-admin", async ( { page } ) => {
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
		const keepDirSiteName = 'E2E-Test-Site-Keep-Dir';
		const { sidebar, siteContent } = await createSite( keepDirSiteName );

		expect(
			await pathExists( path.join( session.homePath, 'Studio', keepDirSiteName, 'wp-config.php' ) )
		).toBe( true );

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

		await expect( sidebar.getSiteNavButton( keepDirSiteName ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( path.join( session.homePath, 'Studio', keepDirSiteName ) ) ).toBe( true );
	} );

	skipTestOnWindows( 'delete site and remove directory from disk', async () => {
		const secondSiteName = 'E2E-Test-Site-2';
		const { sidebar, siteContent } = await createSite( secondSiteName );

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

		await expect( sidebar.getSiteNavButton( secondSiteName ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( path.join( session.homePath, 'Studio', secondSiteName ) ) ).toBe( false );
	} );
} );
