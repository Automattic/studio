import path from 'path';
import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';

test.describe( 'Import', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Import-Test-Site';
	const defaultSiteName = 'My WordPress Website';

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

	test.skip( 'import site from Jetpack backup', async ( { page } ) => {
		const backupPath = path.join( __dirname, 'imports', 'jetpack-backup.tar.gz' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		// Select backup import option
		await expect( modal.backupButton ).toBeVisible();
		await modal.backupButton.click();

		// Upload backup file
		await modal.selectBackupFile( backupPath );

		// Wait for file to be processed and continue button to be enabled
		await session.mainWindow.waitForTimeout( 2000 );
		await modal.continueButton.click();

		// Fill in site name
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for "Importing completed" message to appear
		// Import process can take longer than a regular site creation
		await expect( session.mainWindow.getByText( 'Importing completed' ) ).toBeVisible( {
			timeout: 600_000,
		} );

		// Wait for site to be running
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 30_000 } );

		// Verify site name is displayed
		expect( await siteContent.siteNameHeading ).toHaveText( siteName );

		// Navigate to Settings tab to get frontend URL
		const settingsTab = await siteContent.navigateToTab( 'Settings' );
		expect( await siteContent.frontendButton ).toBeVisible();
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
		expect( frontendUrl ).not.toBeNull();

		// Open the site in a browser and verify content
		await page.goto( frontendUrl );
		await expect( page.getByText( 'Ut quia libero qui' ) ).toBeVisible();
	} );
} );
