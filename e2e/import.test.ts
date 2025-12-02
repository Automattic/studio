import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';

/**
 * Import Tests
 *
 * These tests verify the import functionality for WordPress sites.
 * For instructions on obtaining required test files, see e2e/imports/readme.md
 */
test.describe( 'Import', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Import-Test-Site';
	const defaultSiteName = 'My WordPress Website';

	const backupPath = path.join( __dirname, 'imports', 'jetpack-backup.tar.gz' );
	const backupExists = fs.existsSync( backupPath );
	test.skip(
		! backupExists,
		`Skipping Import tests: Jetpack backup file not found at ${ backupPath }.`
	);

	test.beforeAll( async () => {
		await session.launch();

		// Complete onboarding before tests
		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();

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

	test( 'import site from Jetpack backup', async ( { page } ) => {
		const backupPath = path.join( __dirname, 'imports', 'jetpack-backup.tar.gz' );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await expect( modal.importButton ).toBeVisible();
		await modal.importButton.click();

		await modal.selectBackupFile( backupPath );

		await expect( modal.continueButton ).toBeEnabled( { timeout: 5000 } );
		await modal.continueButton.click();

		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		// Wait for "Importing completed" message to appear
		// Import process can take longer than a regular site creation
		await expect( session.mainWindow.getByText( 'Importing completed' ) ).toBeVisible( {
			timeout: 600_000,
		} );

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 30_000 } );

		await expect( siteContent.siteNameHeading ).toHaveText( siteName );

		const settingsTab = await siteContent.navigateToTab( 'Settings' );
		await expect( siteContent.siteNameHeading ).toHaveText( siteName );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
		expect( frontendUrl ).not.toBeNull();

		// Open the site in a browser and verify content
		await page.goto( frontendUrl );
		await expect( page.getByText( 'Ut quia libero qui' ) ).toBeVisible();
	} );
} );
