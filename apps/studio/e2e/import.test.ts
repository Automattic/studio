import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { DOWNLOADED_FIXTURES_DIR } from './constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

/**
 * Imports a genuine Jetpack Backup of a real WordPress.com site (blog name
 * "Cool Beans"), complementing the minimal fixture in import-formats.test.ts
 * with the structure a customer backup actually has — full uploads tree,
 * bundled plugins, real meta.json. Catching drift in that format is this
 * test's job.
 *
 * The archive is data-heavy, so it is not in the repo: `npm run e2e:fixtures`
 * downloads it per test-fixtures/manifest.json (Playwright's globalSetup runs
 * that automatically; in CI a missing fixture fails the run before this
 * guard is reached). See test-fixtures/readme.md for hosting details.
 */
test.describe( 'Import', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Import-Test-Site';
	const defaultSiteName = 'My WordPress Website';

	const backupPath = path.join(
		DOWNLOADED_FIXTURES_DIR,
		'coolbeans-jetpack-backup-2026-07.tar.gz'
	);
	const backupExists = fs.existsSync( backupPath );
	test.skip(
		! backupExists,
		`Skipping Import tests: backup not found at ${ backupPath } — run \`npm run e2e:fixtures\`.`
	);

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

	test( 'import site from Jetpack backup', async ( { page } ) => {
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();

		await expect( modal.importButton ).toBeVisible();

		// The import option is a drop-zone card with a hidden <input type="file">.
		// Setting the file directly fires its change handler and auto-advances to the
		// backup-create step; clicking the card would open the native OS file dialog,
		// which Playwright can't interact with.
		await modal.selectBackupFile( backupPath );

		// Selecting the backup auto-advances to the create-site form (reused for
		// imports), pre-filled with a default name. Set our name and submit — that
		// submit starts the import; there is no separate "continue" step anymore.
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

		const settingsTab = await siteContent.navigateToTab( 'settings' );
		await expect( siteContent.siteNameHeading ).toHaveText( siteName );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
		expect( frontendUrl ).not.toBeNull();
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// The imported database and theme are being served: the blog name comes
		// from the backup's DB, and the custom cool-beans theme renders its
		// landing-page front page (the blog posts live under their permalinks).
		await page.goto( frontendUrl );
		expect( await page.title() ).toContain( 'Cool Beans' );
		await expect( page.getByText( 'Life is too short for' ).first() ).toBeVisible();

		// The hero post imported. Checked in wp-admin rather than at its frontend
		// permalink: the hero slug contains an emoji, and WordPress canonically
		// redirects `?p=27` to that pretty permalink, whose encoded-slug rewrite
		// handling differs between the sandbox and native-PHP runtimes — so the
		// post isn't reliably reachable on the frontend in CI.
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/edit.php` ) );
		await expect(
			page.locator( 'a.row-title:has-text("Jetpack Backup Import Test Site")' )
		).toBeVisible();
	} );
} );
