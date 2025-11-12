import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '../common/lib/fs-utils';
import { DEFAULT_PHP_VERSION, ALLOWED_PHP_VERSIONS } from '../vendor/wp-now/src/constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';
import fs from 'fs-extra';
import { getUrlWithAutoLogin } from './utils';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;
const DEFAULT_SITE_NAME = 'My WordPress Website';

test.describe( 'Servers', () => {
	const session = new E2ESession();

	async function completeOnboardingWithDefaults() {
		await session.launch();

		// Complete onboarding before tests
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
		await onboarding.continueButton.click();

		await closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	}

	async function closeWhatsNew() {
		const whatsNewModal = new WhatsNewModal( session.mainWindow );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.closeButton.click();
		}
	}

	test.afterEach( async () => {
		await session.cleanup();
	} );

	[
		[ undefined, undefined ],
		[ 'E2E-Test-Site', undefined ],
		[ 'E2E-Test-Site 2', 'hello' ],
	].forEach( ( [ siteName, shortLocalPath ] ) => {
		test( `create site with name ${ siteName } and path ${ shortLocalPath }`, async () => {
			const env: NodeJS.ProcessEnv = {};

			if ( shortLocalPath ) {
				const fullLocalPath = path.join( session.homePath, 'Studio', shortLocalPath );
				await fs.mkdir( fullLocalPath, { recursive: true } );
				env.E2E_OPEN_FOLDER_DIALOG = fullLocalPath;
			}
			await session.launch( env );

			const onboarding = new Onboarding( session.mainWindow );

			if ( siteName ) {
				await onboarding.siteNameInput.fill( siteName );
			} else {
				siteName = await onboarding.siteNameInput.inputValue();
			}

			if ( shortLocalPath ) {
				await onboarding.selectLocalPathForTesting();
			}
			const localPath = await onboarding.localPathInput.inputValue();

			await expect( onboarding.heading ).toBeVisible();
			await onboarding.continueButton.click();

			await closeWhatsNew();

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
		await completeOnboardingWithDefaults();

		const newPhpVersion = ALLOWED_PHP_VERSIONS.find( ( v ) => v !== DEFAULT_PHP_VERSION ) || '8.2';

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		const settingsTab = await siteContent.navigateToTab( 'Settings' );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		const initialPhpVersion = await settingsTab.phpVersionSelect.inputValue();
		expect( initialPhpVersion ).toBe( DEFAULT_PHP_VERSION );

		await settingsTab.phpVersionSelect.selectOption( newPhpVersion );
		await settingsTab.saveButton.click();
		await expect( settingsTab.editSiteDialog ).not.toBeVisible();

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		const updatedPhpVersion = await settingsTab.phpVersionSelect.inputValue();
		expect( updatedPhpVersion ).toBe( newPhpVersion );

		await settingsTab.editSiteDialog.getByRole( 'button', { name: 'Cancel' } ).click();
	} );

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		await completeOnboardingWithDefaults();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
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
		await completeOnboardingWithDefaults();

		const sitePath = path.join(
			session.homePath,
			'Studio',
			DEFAULT_SITE_NAME.replace( /\s/g, '-' )
		);

		expect( await pathExists( path.join( sitePath, 'wp-config.php' ) ) ).toBe( true );

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
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

		expect( await pathExists( sitePath ) ).toBe( true );
	} );

	skipTestOnWindows( 'delete site and remove directory from disk', async () => {
		await completeOnboardingWithDefaults();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
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
		await expect( sidebar.getSiteNavButton( DEFAULT_SITE_NAME ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( path.join( session.homePath, 'Studio', DEFAULT_SITE_NAME ) ) ).toBe(
			false
		);
	} );
} );
