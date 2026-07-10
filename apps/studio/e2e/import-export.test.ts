import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '@studio/common/lib/fs-utils';
import fs from 'fs-extra';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';
import type { MessageBoxOptions } from 'electron';

const global = globalThis as unknown as {
	testDialogCalls?: MessageBoxOptions[];
};

test.describe( 'Import / Export', () => {
	const session = new E2ESession();
	const defaultSiteName = 'My WordPress Website';

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'should show error dialog when importing invalid SQL file', async () => {
		// Use the default site created during onboarding
		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );

		// Navigate to the Import / Export tab
		const tab = await siteContent.navigateToTab( 'import-export' );

		// TypeScript doesn't narrow the union type, so we need to assert it
		// We know it's ImportExportTab because we passed 'Import / Export'
		if ( ! ( 'importDropZone' in tab ) ) {
			throw new Error( 'Expected ImportExportTab but got a different tab type' );
		}
		const importExportTab = tab;

		// Wait for the import/export interface to be ready
		await expect( importExportTab.locator ).toBeVisible();
		await expect( importExportTab.importDropZone ).toBeVisible();

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to track calls and auto-confirm dialogs.
		// Similar to the "delete site" test pattern, but also tracks what was shown.
		// See: https://github.com/microsoft/playwright/issues/21432
		await session.electronApp.evaluate( ( { dialog } ) => {
			// Create storage for dialog calls
			global.testDialogCalls = [];

			// Mock the function to track calls
			dialog.showMessageBox = async ( ...args: unknown[] ) => {
				// Store the call details
				const options = ( args.length === 2 ? args[ 1 ] : args[ 0 ] ) as MessageBoxOptions;
				global.testDialogCalls?.push( options );

				// Auto-confirm by clicking the first button
				return { response: 0, checkboxChecked: false };
			};
		} );

		// Get the path to the invalid SQL file
		const invalidSqlPath = path.join( __dirname, 'fixtures', 'sql', 'invalid-database.sql' );

		// Upload the invalid SQL file
		await importExportTab.uploadFile( invalidSqlPath );

		// Wait for the error dialog to be shown (after the confirmation dialog)
		let errorDialog: MessageBoxOptions | undefined;
		await expect
			.poll(
				async () => {
					const dialogCalls: MessageBoxOptions[] = await session.electronApp.evaluate(
						() => global.testDialogCalls || []
					);
					// Look for the error dialog specifically
					errorDialog = dialogCalls.find(
						( call ) =>
							call.type === 'error' &&
							( call.title?.includes( 'Failed importing site' ) ||
								call.message?.includes( 'Failed importing site' ) )
					);
					return errorDialog;
				},
				{
					timeout: 15000,
					message: 'Expected error dialog to be shown',
				}
			)
			.toBeDefined();

		expect( errorDialog ).toBeDefined();
		expect( errorDialog?.type ).toBe( 'error' );
		expect( errorDialog?.title || errorDialog?.message ).toContain( 'Failed importing site' );
	} );
} );

// Separate session so the dialog mocks and failed-import state of the tests
// above cannot leak into the round trip.
test.describe( 'Export / Import round trip', () => {
	const session = new E2ESession();
	const defaultSiteName = 'My WordPress Website';

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'exports a site and imports the export as a new site', async ( { page } ) => {
		const exportedSiteTitle = 'E2E Export Round Trip';
		const importedSiteName = 'Imported-Export-Site';
		const exportPath = path.join( session.homePath, 'studio-e2e-export.zip' );

		// Give the site a distinctive title so we can prove the imported site
		// carries the exported content rather than a fresh install.
		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		await page.goto( getUrlWithAutoLogin( wpAdminUrl + '/options-general.php' ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( exportedSiteTitle );
		await siteTitleInput.press( 'Enter' );
		await expect( page.locator( '#setting-error-settings_updated' ) ).toBeVisible();

		// Playwright can't drive the native save dialog, so mock it to return our
		// export path (same pattern as the delete-site dialog mocks).
		await session.electronApp.evaluate(
			( { dialog }, { exportPath } ) => {
				dialog.showSaveDialog = async () => ( { canceled: false, filePath: exportPath } );
			},
			{ exportPath }
		);

		const tab = await siteContent.navigateToTab( 'import-export' );
		if ( ! ( 'exportFullSiteButton' in tab ) ) {
			throw new Error( 'Expected ImportExportTab but got a different tab type' );
		}
		await tab.exportFullSiteButton.click();
		await expect( session.mainWindow.getByText( 'Site export completed' ) ).toBeVisible( {
			timeout: 120_000,
		} );

		expect( await pathExists( exportPath ) ).toBe( true );
		expect( ( await fs.stat( exportPath ) ).size ).toBeGreaterThan( 0 );

		// Import the export back as a new site.
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();
		await expect( modal.importButton ).toBeVisible();
		await modal.selectBackupFile( exportPath );
		await modal.siteNameInput.fill( importedSiteName );
		await modal.addSiteButton.click();

		await expect( session.mainWindow.getByText( 'Importing completed' ) ).toBeVisible( {
			timeout: 120_000,
		} );

		const importedSiteContent = new SiteContent( session.mainWindow, importedSiteName );
		await expect( importedSiteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// The imported site serves the exported content.
		const importedSettingsTab = await importedSiteContent.navigateToTab( 'settings' );
		const importedFrontendUrl = await importedSettingsTab.copySiteUrlToClipboard(
			session.electronApp
		);
		await page.goto( importedFrontendUrl );
		expect( await page.title() ).toBe( exportedSiteTitle );
	} );
} );
