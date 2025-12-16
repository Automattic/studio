import path from 'path';
import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
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
		try {
			await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
		} catch ( error ) {
			// Print DOM structure on failure
			const html = await session.mainWindow.content();
			console.error( 'DOM Structure when assertion failed:' );
			console.error( html );

			// Also take a screenshot for visual debugging
			await session.mainWindow.screenshot( { path: 'failure-screenshot.png' } );

			throw error;
		}
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'should show error dialog when importing invalid SQL file', async () => {
		// Use the default site created during onboarding
		const siteContent = new SiteContent( session.mainWindow, defaultSiteName );

		// Navigate to the Import / Export tab
		const tab = await siteContent.navigateToTab( 'Import / Export' );

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
