import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { BACKUP_FIXTURES_DIR } from './constants';
import { E2ESession, launchWithSite } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import SiteOverview from './page-objects/site-overview';
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
	let existingSiteName: string;

	const waitForImport = async () => {
		await expect( session.mainWindow.getByText( 'Import finished' ).first() ).toBeVisible( {
			timeout: 120_000,
		} );
	};

	const importNewSiteFromBackup = async ( backupPath: string, siteName: string ) => {
		await new AddSite( session.mainWindow ).importSite( backupPath, siteName );
		await waitForImport();
		await new Sidebar( session.mainWindow ).expectRunning( siteName );
		return siteName;
	};

	const assertImportedSiteContent = async ( page: Page, siteName: string ) => {
		const siteUrl = await session.getSiteUrl( siteName );

		// The import can report completion while the server is still being
		// (re)started, so wait until the site actually responds.
		await expect
			.poll(
				async () => {
					try {
						return ( await fetch( siteUrl ) ).status;
					} catch {
						return 0;
					}
				},
				{ timeout: 60_000 }
			)
			.toBe( 200 );

		// The frontend serves the fixture's database (its blog name).
		await page.goto( siteUrl );
		expect( await page.title() ).toContain( FIXTURE_SITE_TITLE );

		// The fixture's posts were imported.
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/edit.php` ) );
		await expect( page.locator( 'a.row-title:has-text("Hello world!")' ) ).toBeVisible();

		// The fixture's pages were imported.
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/edit.php?post_type=page` ) );
		await expect( page.locator( 'a.row-title:has-text("Services")' ) ).toBeVisible();
		await expect( page.locator( 'a.row-title:has-text("Contact")' ) ).toBeVisible();

		// The fixture's custom theme is installed and active. Assert attachment
		// rather than visibility: the theme ships no screenshot, so wp-admin
		// renders its card with a zero-size preview box.
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/themes.php` ) );
		await expect( page.locator( '.theme.active[data-slug="mypet-theme"]' ) ).toBeAttached();
	};

	test.beforeAll( async () => {
		( { siteName: existingSiteName } = await launchWithSite( session ) );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		// Run one site at a time to keep peak memory low on constrained hosts.
		await session.mainWindow.evaluate( () => window.ipcApi.stopAllServers() );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	for ( const [ format, file ] of [
		[ 'Jetpack', 'jetpack-backup.tar.gz' ],
		[ 'Local', 'local-backup.zip' ],
		[ 'Playground', 'playground-backup.zip' ],
		[ '.wpress', 'aio-backup.wpress' ],
	] ) {
		test( `imports a new site from a ${ format } backup file`, async ( { page } ) => {
			const siteName = await importNewSiteFromBackup(
				path.join( BACKUP_FIXTURES_DIR, file ),
				`${ format.replace( '.', '' ) }-Import-Site`
			);
			await assertImportedSiteContent( page, siteName );
		} );
	}

	test( 'imports a backup file into an existing site', async ( { page } ) => {
		// Import into the site while it's stopped (afterEach stops everything): a
		// running site spawns WP-CLI processes (theme details, site icon) that race
		// the database import. The import starts the server itself on completion.
		const overview = new SiteOverview( session.mainWindow );
		await overview.open( existingSiteName );
		await overview.importBackup( path.join( BACKUP_FIXTURES_DIR, 'local-backup.zip' ) );
		await waitForImport();

		await assertImportedSiteContent( page, existingSiteName );
	} );
} );
