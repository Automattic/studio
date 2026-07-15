import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { BACKUP_FIXTURES_DIR, DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

/**
 * Imports for the Jetpack, Local, Playground and .wpress backup formats, plus
 * importing a backup into an existing site.
 *
 * The Jetpack fixture mimics the real per-table layout (sql/wp_*.sql +
 * meta.json), exercising the multi-file SQL import path; the release-time test
 * against a genuine WordPress.com backup remains in import.test.ts.
 *
 * The fixture archives under test-fixtures/backups/ were generated from a demo
 * Studio site (blog name "MyPet") with a custom theme, so each test can prove
 * the imported site serves the backup's content — custom theme and database —
 * rather than a fresh install. See test-fixtures/backups/readme.md for their
 * provenance and structure.
 */
const FIXTURE_SITE_TITLE = 'MyPet';

test.describe( 'Import backup formats', () => {
	const session = new E2ESession();

	const stopAllSites = async () => {
		const sidebar = new MainSidebar( session.mainWindow );
		const stopAllButton = sidebar.getStopAllButton();
		if ( await stopAllButton.isVisible().catch( () => false ) ) {
			await stopAllButton.click();
			await expect( sidebar.locator.getByText( 'No sites running' ) ).toBeAttached( {
				timeout: 60_000,
			} );
		}
	};

	const importNewSiteFromBackup = async ( backupPath: string, siteName: string ) => {
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();
		await expect( modal.importButton ).toBeVisible();
		await modal.selectBackupFile( backupPath );
		await modal.siteNameInput.fill( siteName );
		await modal.addSiteButton.click();

		await expect( session.mainWindow.getByText( 'Importing completed' ) ).toBeVisible( {
			timeout: 120_000,
		} );

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
		return siteContent;
	};

	const assertImportedSiteContent = async ( page: Page, siteContent: SiteContent ) => {
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );

		// The import UI can report completion while the server is still being
		// (re)started, so wait until the site actually responds.
		await expect
			.poll(
				async () => {
					try {
						return ( await fetch( frontendUrl ) ).status;
					} catch {
						return 0;
					}
				},
				{ timeout: 60_000 }
			)
			.toBe( 200 );

		// The frontend serves the fixture's database (its blog name).
		await page.goto( frontendUrl );
		expect( await page.title() ).toContain( FIXTURE_SITE_TITLE );

		// The fixture's posts were imported.
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/edit.php` ) );
		await expect( page.locator( 'a.row-title:has-text("Hello world!")' ) ).toBeVisible();

		// The fixture's pages were imported.
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/edit.php?post_type=page` ) );
		await expect( page.locator( 'a.row-title:has-text("Services")' ) ).toBeVisible();
		await expect( page.locator( 'a.row-title:has-text("Contact")' ) ).toBeVisible();

		// The fixture's custom theme is installed and active. Assert attachment
		// rather than visibility: the theme ships no screenshot, so wp-admin
		// renders its card with a zero-size preview box.
		await page.goto( getUrlWithAutoLogin( `${ wpAdminUrl }/themes.php` ) );
		await expect( page.locator( '.theme.active[data-slug="mypet-theme"]' ) ).toBeAttached();
	};

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		// Run one site at a time to keep peak memory low on constrained hosts.
		await stopAllSites();
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'imports a new site from a Jetpack backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup(
			path.join( BACKUP_FIXTURES_DIR, 'jetpack-backup.tar.gz' ),
			'Jetpack-Import-Site'
		);
		await assertImportedSiteContent( page, siteContent );
	} );

	test( 'imports a new site from a Local backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup(
			path.join( BACKUP_FIXTURES_DIR, 'local-backup.zip' ),
			'Local-Import-Site'
		);
		await assertImportedSiteContent( page, siteContent );
	} );

	test( 'imports a new site from a Playground backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup(
			path.join( BACKUP_FIXTURES_DIR, 'playground-backup.zip' ),
			'Playground-Import-Site'
		);
		await assertImportedSiteContent( page, siteContent );
	} );

	test( 'imports a new site from a .wpress backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup(
			path.join( BACKUP_FIXTURES_DIR, 'aio-backup.wpress' ),
			'Wpress-Import-Site'
		);
		await assertImportedSiteContent( page, siteContent );
	} );

	test( 'imports a backup file into an existing site', async ( { page } ) => {
		// Import into the onboarding site while it's stopped: starting it first
		// spawns WP-CLI processes (theme details, site icon) that race the
		// database import and intermittently fail it. The import starts the
		// server itself on completion.
		const sidebar = new MainSidebar( session.mainWindow );
		await sidebar.getSiteNavButton( DEFAULT_SITE_NAME ).click();
		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		// On retries, beforeAll leaves the site running — stop it.
		await stopAllSites();

		// Auto-confirm the import's native confirmation dialog, recording all
		// dialogs so a failure surfaces its message below.
		await session.stubMessageBox();

		const tab = await siteContent.navigateToTab( 'import-export' );
		if ( ! ( 'uploadFile' in tab ) ) {
			throw new Error( 'Expected ImportExportTab but got a different tab type' );
		}
		await tab.uploadFile( path.join( BACKUP_FIXTURES_DIR, 'local-backup.zip' ) );
		// Wait for the completion banner, but fail fast with the recorded
		// dialog message if the import errors instead.
		await expect
			.poll(
				async () => {
					const failure = ( await session.getRecordedDialogs() ).find( ( entry ) =>
						entry.includes( 'Failed importing site' )
					);
					if ( failure ) {
						throw new Error( `Import failed: ${ failure }` );
					}
					return tab.importCompleteBanner.isVisible();
				},
				{ timeout: 120_000 }
			)
			.toBe( true );

		await assertImportedSiteContent( page, siteContent );
	} );
} );
