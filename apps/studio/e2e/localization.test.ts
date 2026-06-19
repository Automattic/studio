import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import AddSiteModal from './page-objects/add-site-modal';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

test.describe( 'Localization', () => {
	const session = new E2ESession();

	// Helper function to open settings using data-testid
	const openSettings = async ( page: typeof session.mainWindow ) => {
		const settingsButton = page.getByTestId( 'settings-button' );
		await expect( settingsButton ).toBeVisible();
		await settingsButton.click();
	};

	// Helper to change language
	const changeLanguage = async ( page: typeof session.mainWindow, localeCode: string ) => {
		await openSettings( page );

		// Wait for Settings modal
		const settingsModal = page.getByRole( 'dialog' );
		await expect( settingsModal ).toBeVisible( { timeout: 10_000 } );

		// Select language using data-testid
		const languageSelect = page.getByTestId( 'language-select' );
		await expect( languageSelect ).toBeVisible( { timeout: 10_000 } );
		await languageSelect.selectOption( localeCode );

		// Click Save button using data-testid
		const saveButton = page.getByTestId( 'preferences-save-button' );
		await expect( saveButton ).toBeVisible();
		await expect( saveButton ).toBeEnabled(); // Wait for it to be enabled
		await saveButton.click();

		// Wait for modal to close
		await expect( settingsModal ).not.toBeVisible( { timeout: 5_000 } );
	};

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, 'My WordPress Website' );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'changes language from settings', async () => {
		const sidebar = new MainSidebar( session.mainWindow );

		await changeLanguage( session.mainWindow, 'fr' );
		await expect( sidebar.addSiteButton ).toHaveText( 'Ajouter un site' );
		await changeLanguage( session.mainWindow, 'en' );
		await expect( sidebar.addSiteButton ).toHaveText( 'Add site' );
	} );

	test( 'supports RTL languages', async () => {
		const sidebar = new MainSidebar( session.mainWindow );

		await changeLanguage( session.mainWindow, 'ar' );
		const htmlDir = await session.mainWindow.evaluate( () => document.documentElement.dir );
		expect( htmlDir ).toBe( 'rtl' );
		await expect( sidebar.addSiteButton ).toHaveText( 'إضافة موقع' );
		await changeLanguage( session.mainWindow, 'en' );

		const htmlDirEnglish = await session.mainWindow.evaluate( () => document.documentElement.dir );
		expect( htmlDirEnglish ).toBe( 'ltr' );
		await expect( sidebar.addSiteButton ).toHaveText( 'Add site' );
	} );

	test( 'persists selected language when re-opening app', async () => {
		const sidebar = new MainSidebar( session.mainWindow );

		await changeLanguage( session.mainWindow, 'de' );
		await expect( sidebar.addSiteButton ).toHaveText( 'Website hinzufügen' );
		await session.restart();
		await session.mainWindow.waitForLoadState( 'domcontentloaded' );

		const onboarding = new Onboarding( session.mainWindow );
		try {
			const visible = await onboarding.heading.isVisible( { timeout: 2000 } );
			if ( visible ) {
				await onboarding.completeOnboarding();
			}
		} catch ( error ) {
			// Onboarding not visible, continue with test
		}

		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, 'My WordPress Website' );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		const sidebarAfterRestart = new MainSidebar( session.mainWindow );
		await expect( sidebarAfterRestart.addSiteButton ).toHaveText( 'Website hinzufügen' );

		await changeLanguage( session.mainWindow, 'en' );
	} );

	test( 'created site language matches Studio language', async ( { page } ) => {
		const siteName = 'Localized-Site-Test';
		const sidebar = new MainSidebar( session.mainWindow );
		const addSiteModal = new AddSiteModal( session.mainWindow );

		// Change to Japanese
		await changeLanguage( session.mainWindow, 'ja' );

		// Verify language changed
		await expect( sidebar.addSiteButton ).toHaveText( 'サイトを追加' );

		// Open add site modal
		await sidebar.addSiteButton.click();
		await expect( addSiteModal.locator ).toBeVisible( { timeout: 5000 } );

		// Click "Create a site" option using data-testid
		await expect( addSiteModal.createSiteButton ).toBeVisible();
		await addSiteModal.createSiteButton.click();

		// Use force:true because the app-drag-region overlay intercepts pointer events.
		const emptySiteBtn = session.mainWindow.getByTestId( 'empty-site-card' );
		await expect( emptySiteBtn ).toBeVisible( { timeout: 5000 } );
		await emptySiteBtn.click( { force: true } );
		await addSiteModal.continueButton.click();

		// Fill in site name using data-testid
		await expect( addSiteModal.siteNameInput ).toBeVisible( { timeout: 5000 } );
		await addSiteModal.siteNameInput.fill( siteName );

		// Click "Add site" button using data-testid (wait for it to be enabled)
		await expect( addSiteModal.addSiteButton ).toBeVisible();
		await expect( addSiteModal.addSiteButton ).toBeEnabled();
		await addSiteModal.addSiteButton.click();

		// Wait for site to be created
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const settingsTabButton = session.mainWindow.locator( '[role="tab"][id$="-settings"]' );
		await settingsTabButton.click();
		const copyWpAdminButton = session.mainWindow.getByTestId( 'copy-wp-admin-url' );
		await expect( copyWpAdminButton ).toBeVisible();
		await copyWpAdminButton.click();
		const wpAdminUrl = await session.electronApp.evaluate( ( app ) => app.clipboard.readText() );

		// Check WordPress site language
		// Use getUrlWithAutoLogin to automatically authenticate with WordPress admin
		// This works cross-platform by appending authentication parameters to the URL
		const optionsGeneralUrl = wpAdminUrl + '/options-general.php';
		await page.goto( getUrlWithAutoLogin( optionsGeneralUrl ) );

		const languageSelect = page.locator( '#WPLANG' );
		const selectedLanguage = await languageSelect.inputValue();

		expect( selectedLanguage ).toBe( 'ja' );

		await changeLanguage( session.mainWindow, 'en' );
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: true };
			};
		} );

		const siteContentEnglish = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContentEnglish.navigateToTab( 'settings' );
		await settingsTab.openDeleteSiteModal();

		// Wait for the confirmation dialog to be auto-confirmed and deletion to complete
		// Verify site was deleted by checking it no longer appears in sidebar
		const deletedSite = session.mainWindow.getByRole( 'button', { name: siteName, exact: true } );
		await expect( deletedSite ).not.toBeVisible( { timeout: 30_000 } );
	} );
} );
