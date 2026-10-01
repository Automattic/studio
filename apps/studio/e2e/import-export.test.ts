import path from 'path';
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession, launchWithSite } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import SiteOverview from './page-objects/site-overview';
import { getUrlWithAutoLogin } from './utils';

test.describe( 'Import / Export', () => {
	const session = new E2ESession();
	let siteName: string;

	test.beforeAll( async () => {
		( { siteName } = await launchWithSite( session ) );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'reports a failed import of an invalid SQL file', async () => {
		const overview = new SiteOverview( session.mainWindow );
		await overview.open( siteName );
		await overview.importBackup(
			path.join( __dirname, 'fixtures', 'sql', 'invalid-database.sql' )
		);

		await expect( session.mainWindow.getByText( "Import didn't complete" ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );
} );

// Separate session so the failed import above cannot leak into the round trip.
test.describe( 'Export / Import round trip', () => {
	const session = new E2ESession();
	let siteName: string;

	test.beforeAll( async () => {
		( { siteName } = await launchWithSite( session ) );
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

		// A distinctive title proves the imported site carries the exported content.
		const siteUrl = await session.getSiteUrl( siteName );
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/options-general.php` ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( exportedSiteTitle );
		await siteTitleInput.press( 'Enter' );
		await expect( page.locator( '#setting-error-settings_updated' ) ).toBeVisible();

		// Playwright can't drive the native save dialog. Once written, the export is revealed in
		// the file manager, which doubles as the signal that it finished.
		await session.electronApp.evaluate(
			( { dialog, shell }, { exportPath } ) => {
				const state = globalThis as typeof globalThis & { __e2eRevealed?: string };
				dialog.showSaveDialog = async () => ( { canceled: false, filePath: exportPath } );
				shell.showItemInFolder = ( fullPath: string ) => {
					state.__e2eRevealed = fullPath;
				};
			},
			{ exportPath }
		);

		const overview = new SiteOverview( session.mainWindow );
		await overview.open( siteName );
		await overview.manageButton( 'Export entire site' ).click();
		await expect
			.poll(
				() =>
					session.electronApp.evaluate(
						() => ( globalThis as typeof globalThis & { __e2eRevealed?: string } ).__e2eRevealed
					),
				{ timeout: 120_000 }
			)
			.toBe( exportPath );
		expect( ( await fs.stat( exportPath ) ).size ).toBeGreaterThan( 0 );

		await new AddSite( session.mainWindow ).importSite( exportPath, importedSiteName );
		await expect( session.mainWindow.getByText( 'Import finished' ) ).toBeVisible( {
			timeout: 120_000,
		} );
		await new Sidebar( session.mainWindow ).expectRunning( importedSiteName );

		await page.goto( await session.getSiteUrl( importedSiteName ) );
		expect( await page.title() ).toBe( exportedSiteTitle );
	} );
} );
