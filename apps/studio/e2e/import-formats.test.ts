import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs-extra';
import JSZip from 'jszip';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

// Minimal .wpress (All-in-One WP Migration) writer, mirroring the archive
// format documented in apps/cli/lib/import-export/import/handlers/backup-handler-wpress.ts:
// a 4377-byte header per file (name @0, size @255, mtime @269, prefix @281)
// followed by the raw content, terminated by an all-zero header block.
const WPRESS_HEADER_SIZE = 4377;

function wpressHeader( name: string, size: number, prefix: string ): Buffer {
	const header = Buffer.alloc( WPRESS_HEADER_SIZE );
	header.write( name, 0, 'utf8' );
	header.write( String( size ), 255, 'utf8' );
	header.write( '0', 269, 'utf8' );
	header.write( prefix, 281, 'utf8' );
	return header;
}

function buildWpress( entries: { name: string; prefix: string; content: Buffer }[] ): Buffer {
	const parts: Buffer[] = [];
	for ( const { name, prefix, content } of entries ) {
		parts.push( wpressHeader( name, content.length, prefix ) );
		parts.push( content );
	}
	parts.push( Buffer.alloc( WPRESS_HEADER_SIZE ) );
	return Buffer.concat( parts );
}

async function collectFilesRecursively(
	rootDir: string
): Promise< { relPath: string; content: Buffer }[] > {
	const results: { relPath: string; content: Buffer }[] = [];
	const walk = async ( dir: string ) => {
		for ( const entry of await fs.readdir( dir, { withFileTypes: true } ) ) {
			const absPath = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				await walk( absPath );
			} else if ( entry.isFile() ) {
				results.push( {
					relPath: path.relative( rootDir, absPath ).split( path.sep ).join( '/' ),
					content: await fs.readFile( absPath ),
				} );
			}
		}
	};
	await walk( rootDir );
	return results;
}

/**
 * Imports for the Local, Playground and .wpress backup formats.
 *
 * Rather than depending on externally supplied fixtures (as the Jetpack import
 * test does), the fixtures are synthesized in beforeAll from the onboarding
 * site itself: its database export becomes the SQL dump for the Local and
 * .wpress archives, and its SQLite database file becomes the Playground
 * database. The site is given a distinctive title first, so each test can
 * prove the imported site serves the backup's content and not a fresh install.
 */
test.describe( 'Import backup formats', () => {
	const session = new E2ESession();
	const sourceTitle = 'E2E Import Formats Source';

	let fixturesDir: string;
	let localBackupPath: string;
	let playgroundBackupPath: string;
	let wpressBackupPath: string;

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

	const setSiteTitle = async ( page: Page, siteContent: SiteContent, title: string ) => {
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		await page.goto( getUrlWithAutoLogin( wpAdminUrl + '/options-general.php' ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( title );
		await siteTitleInput.press( 'Enter' );
		await expect( page.locator( '#setting-error-settings_updated' ) ).toBeVisible();
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

	const assertFrontendTitle = async ( page: Page, siteContent: SiteContent, title: string ) => {
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );
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
		await page.goto( frontendUrl );
		expect( await page.title() ).toBe( title );
	};

	test.beforeAll( async ( { browser } ) => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Mark the source site so imported content is distinguishable.
		const page = await browser.newPage();
		await setSiteTitle( page, siteContent, sourceTitle );
		await page.close();

		// Export the source site's database (the native save dialog can't be
		// driven by Playwright, so mock it to return our dump path).
		fixturesDir = path.join( session.homePath, 'generated-backups' );
		await fs.ensureDir( fixturesDir );
		const dbDumpPath = path.join( fixturesDir, 'db-export.sql' );
		await session.electronApp.evaluate(
			( { dialog }, { dbDumpPath } ) => {
				dialog.showSaveDialog = async () => ( { canceled: false, filePath: dbDumpPath } );
			},
			{ dbDumpPath }
		);
		const tab = await siteContent.navigateToTab( 'import-export' );
		if ( ! ( 'exportDatabaseButton' in tab ) ) {
			throw new Error( 'Expected ImportExportTab but got a different tab type' );
		}
		await tab.exportDatabaseButton.click();
		await expect( session.mainWindow.getByText( 'Database export completed' ) ).toBeVisible( {
			timeout: 120_000,
		} );

		// Stop the site before snapshotting its SQLite database file.
		await stopAllSites();
		const cliConfig = await fs.readJson( path.join( session.cliConfigPath, 'cli.json' ) );
		const sourceSite = cliConfig.sites.find(
			( s: { name: string } ) => s.name === DEFAULT_SITE_NAME
		);
		const sqliteDbPath = path.join( sourceSite.path, 'wp-content', 'database', '.ht.sqlite' );

		const dbDump = await fs.readFile( dbDumpPath );

		// Importing replaces the destination's wp-content with the backup's, so
		// the archives must carry real themes/plugins (as genuine backups do) or
		// the imported site would boot without its active theme.
		const wpContentDir = path.join( sourceSite.path, 'wp-content' );
		const wpContentFiles = [
			...( await collectFilesRecursively( path.join( wpContentDir, 'themes' ) ) ).map(
				( file ) => ( { ...file, relPath: `themes/${ file.relPath }` } )
			),
			...( await collectFilesRecursively( path.join( wpContentDir, 'plugins' ) ) ).map(
				( file ) => ( { ...file, relPath: `plugins/${ file.relPath }` } )
			),
			{ relPath: 'uploads/e2e-import-marker.txt', content: Buffer.from( 'e2e' ) },
		];

		// Local (by Flywheel) backup: app/sql/*.sql + app/public/wp-content/*.
		const localZip = new JSZip();
		localZip.file( 'app/sql/local.sql', dbDump );
		for ( const { relPath, content } of wpContentFiles ) {
			localZip.file( `app/public/wp-content/${ relPath }`, content );
		}
		localBackupPath = path.join( fixturesDir, 'local-backup.zip' );
		await fs.writeFile( localBackupPath, await localZip.generateAsync( { type: 'nodebuffer' } ) );

		// Playground backup: wp-content/ with an .ht.sqlite database.
		const playgroundZip = new JSZip();
		playgroundZip.file( 'wp-content/database/.ht.sqlite', await fs.readFile( sqliteDbPath ) );
		for ( const { relPath, content } of wpContentFiles ) {
			playgroundZip.file( `wp-content/${ relPath }`, content );
		}
		playgroundBackupPath = path.join( fixturesDir, 'playground-backup.zip' );
		await fs.writeFile(
			playgroundBackupPath,
			await playgroundZip.generateAsync( { type: 'nodebuffer' } )
		);

		// All-in-One WP Migration backup: database.sql + package.json at the root,
		// with wp-content children (themes, plugins, uploads) as top-level dirs.
		wpressBackupPath = path.join( fixturesDir, 'aio-backup.wpress' );
		await fs.writeFile(
			wpressBackupPath,
			buildWpress( [
				{ name: 'database.sql', prefix: '', content: dbDump },
				{ name: 'package.json', prefix: '', content: Buffer.from( '{}' ) },
				...wpContentFiles.map( ( { relPath, content } ) => ( {
					name: path.posix.basename( relPath ),
					prefix: path.posix.dirname( relPath ),
					content,
				} ) ),
			] )
		);
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		// Run one site at a time to keep peak memory low on constrained hosts.
		await stopAllSites();
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'imports a new site from a Local backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup( localBackupPath, 'Local-Import-Site' );
		await assertFrontendTitle( page, siteContent, sourceTitle );
	} );

	test( 'imports a new site from a Playground backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup(
			playgroundBackupPath,
			'Playground-Import-Site'
		);
		await assertFrontendTitle( page, siteContent, sourceTitle );
	} );

	test( 'imports a new site from a .wpress backup file', async ( { page } ) => {
		const siteContent = await importNewSiteFromBackup( wpressBackupPath, 'Wpress-Import-Site' );
		await assertFrontendTitle( page, siteContent, sourceTitle );
	} );

	test( 'imports a backup file into an existing site', async ( { page } ) => {
		// Restart the source site and move its title away from the backup's, so a
		// successful import is observable as the title reverting.
		const sidebar = new MainSidebar( session.mainWindow );
		await sidebar.getSiteNavButton( DEFAULT_SITE_NAME ).click();
		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await siteContent.locator.getByRole( 'button', { name: 'Start' } ).click();
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		await setSiteTitle( page, siteContent, 'Temporary Overwritten Title' );

		// The tab's import flow asks for confirmation via a native dialog.
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => ( { response: 0, checkboxChecked: false } );
		} );

		const tab = await siteContent.navigateToTab( 'import-export' );
		if ( ! ( 'uploadFile' in tab ) ) {
			throw new Error( 'Expected ImportExportTab but got a different tab type' );
		}
		await tab.uploadFile( localBackupPath );
		// Unlike the new-site flow, the tab's import UI reports completion with
		// "Import complete!".
		await expect( session.mainWindow.getByText( 'Import complete!' ) ).toBeVisible( {
			timeout: 120_000,
		} );

		await assertFrontendTitle( page, siteContent, sourceTitle );
	} );
} );
