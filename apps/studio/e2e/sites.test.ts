import path from 'path';
import { test, expect } from '@playwright/test';
import { arePathsEqual, pathExists } from '@studio/common/lib/fs-utils';
import {
	RecommendedPHPVersion as DEFAULT_PHP_VERSION,
	SupportedPHPVersions as ALLOWED_PHP_VERSIONS,
} from '@studio/common/types/php-versions';
import fs from 'fs-extra';
import { DEFAULT_SITE_NAME } from './constants';
import { E2ESession } from './e2e-helpers';
import AddSiteModal from './page-objects/add-site-modal';
import MainSidebar from './page-objects/main-sidebar';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;
const session = new E2ESession();

async function completeOnboardingWithParams( customSiteName?: string, customFolderName?: string ) {
	const env: NodeJS.ProcessEnv = {};

	if ( customFolderName ) {
		const fullLocalPath = path.join( session.homePath, 'Studio', customFolderName );
		await fs.mkdir( fullLocalPath, { recursive: true } );
		env.E2E_OPEN_FOLDER_DIALOG = fullLocalPath;
	}
	await session.launch( env );

	const onboarding = new Onboarding( session.mainWindow );
	const { siteName, localPath } = await onboarding.completeOnboarding( {
		customSiteName,
		customFolderName,
	} );

	await onboarding.closeWhatsNew();

	const siteContent = new SiteContent( session.mainWindow, siteName );
	await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

	return {
		siteName,
		localPath,
	};
}

/**
 * Drive the "Add site" modal through the create-site flow while selecting a
 * pre-existing local folder (returned by the mocked folder dialog via the
 * E2E_OPEN_FOLDER_DIALOG env var). When that folder already contains a
 * WordPress install, Studio adopts it instead of scaffolding a new one.
 *
 * Mirrors the onboarding order (name first, then path) so selecting the path
 * doesn't get clobbered by the site-name-driven path regeneration.
 */
async function addSiteFromSelectedPath(
	modal: AddSiteModal,
	siteName: string,
	folderName: string
) {
	await modal.createSiteButton.click();

	const emptySiteButton = session.mainWindow.getByRole( 'button', { name: /Empty site/ } );
	if ( await emptySiteButton.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
		await emptySiteButton.click();
		await modal.continueButton.click();
	}

	await expect( modal.siteNameInput ).toBeVisible( { timeout: 5000 } );
	await modal.siteNameInput.fill( siteName );
	await modal.selectLocalPathForTesting( folderName );

	await expect( modal.addSiteButton ).toBeEnabled();
	await modal.addSiteButton.click();
}

test.describe( 'Sites', () => {
	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		await session.cleanup();
	} );

	[
		[ undefined, undefined ],
		[ 'E2E-Test-Site', undefined ],
		[ 'E2E-Test-Site 2', 'hello' ],
	].forEach( ( [ customSiteName, customFolderName ] ) => {
		test( `create site with name ${ customSiteName } and path ${ customFolderName }`, async () => {
			const { siteName, localPath } = await completeOnboardingWithParams(
				customSiteName,
				customFolderName
			);

			// Check the site is running
			const siteContent = new SiteContent( session.mainWindow, siteName );
			await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
			await expect( siteContent.siteNameHeading ).toHaveText( siteName );

			const sidebar = new MainSidebar( session.mainWindow );
			const siteTitle = sidebar.getSiteNavButton( siteName );
			await expect( siteTitle ).toHaveText( siteName );

			// Check a WordPress site has been created
			expect( await pathExists( path.join( localPath, 'wp-config.php' ) ) ).toBe( true );

			await siteContent.navigateToTab( 'settings' );

			await expect( siteContent.frontendButton ).toBeVisible();
			const frontendUrl = await siteContent.frontendButton.textContent();
			expect( frontendUrl ).not.toBeNull();
			const response = await fetch( `http://${ frontendUrl }` );
			expect( [ 200, 302 ] ).toContain( response.status );
			expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
		} );
	} );

	test( 'change PHP version', async () => {
		await completeOnboardingWithParams();

		const newPhpVersion = ALLOWED_PHP_VERSIONS.find( ( v ) => v !== DEFAULT_PHP_VERSION ) || '8.2';

		const siteContent = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		const settingsTab = await siteContent.navigateToTab( 'settings' );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		const initialPhpVersion = await settingsTab.phpVersionSelect.inputValue();
		expect( initialPhpVersion ).toBe( DEFAULT_PHP_VERSION );

		await settingsTab.phpVersionSelect.selectOption( newPhpVersion );
		await settingsTab.saveButton.click();
		await expect( settingsTab.editSiteDialog ).not.toBeVisible( { timeout: 120_000 } );

		// The dialog seeds its dropdown from `useState(selectedSite.phpVersion)`
		// at mount time and never resyncs on later prop changes, so reopening
		// before the SITE_EVENTS.UPDATED round-trip (CLI _events socket → main
		// → renderer Redux) lands will lock the dropdown to the stale value
		// indefinitely. Wait on the read-only Settings-tab row first — it's
		// bound directly to Redux, so it flips as soon as the round-trip
		// completes.
		await expect( settingsTab.phpVersionDisplay ).toContainText( newPhpVersion );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		await expect( settingsTab.phpVersionSelect ).toHaveValue( newPhpVersion );

		await settingsTab.editSiteDialog.getByRole( 'button', { name: 'Cancel' } ).click();
	} );

	test( 'renames a site', async () => {
		const { siteName } = await completeOnboardingWithParams();

		const newSiteName = 'E2E-Test-Site-Renamed';
		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'settings' );

		await settingsTab.editSiteButton.click();
		await expect( settingsTab.editSiteDialog ).toBeVisible();

		await settingsTab.siteNameInput.fill( newSiteName );
		await settingsTab.saveButton.click();
		await expect( settingsTab.editSiteDialog ).not.toBeVisible( { timeout: 20_000 } );

		// Explicitly wait for the rename to propagate
		const renamedSiteContent = new SiteContent( session.mainWindow, newSiteName );
		await expect( renamedSiteContent.siteNameHeading ).toHaveText( newSiteName, {
			timeout: 10000,
		} );
	} );

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		const { siteName } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'settings' );

		const wpAdminUrl = await settingsTab.copyWPAdminUrlToClipboard( session.electronApp );
		const frontendUrl = await settingsTab.copySiteUrlToClipboard( session.electronApp );

		// page.goto opens a browser
		const optionsGeneralUrl = wpAdminUrl + '/options-general.php';
		await page.goto( getUrlWithAutoLogin( optionsGeneralUrl ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( 'testing site title' );
		await siteTitleInput.press( 'Enter' );

		await page.goto( frontendUrl );
		expect( await page.title() ).toBe( 'testing site title' );
	} );

	skipTestOnWindows( 'delete site but keep directory on disk', async () => {
		const { siteName, localPath } = await completeOnboardingWithParams();

		expect( await pathExists( path.join( localPath, 'wp-config.php' ) ) ).toBe( true );

		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'settings' );

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to simulate the user clicking the "Delete site"
		// confirmation button without "Delete site files from my computer" checked.
		// See: https://github.com/microsoft/playwright/issues/21432
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: false };
			};
		} );
		await settingsTab.openDeleteSiteModal();
		await session.mainWindow.waitForTimeout( 1000 );

		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( DEFAULT_SITE_NAME ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( localPath ) ).toBe( true );
	} );

	skipTestOnWindows( 'delete site and remove directory from disk', async () => {
		const { siteName, localPath } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		const settingsTab = await siteContent.navigateToTab( 'settings' );

		// Playwright lacks support for interacting with native dialogs, so we mock
		// the dialog module to simulate the user clicking the "Delete site"
		// confirmation button with "Delete site files from my computer" checked.
		// See: https://github.com/microsoft/playwright/issues/21432
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: true };
			};
		} );
		await settingsTab.openDeleteSiteModal();
		await session.mainWindow.waitForTimeout( 1000 );

		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( siteName ) ).not.toBeAttached( {
			timeout: 10000,
		} );

		expect( await pathExists( localPath ) ).toBe( false );
	} );

	// Adopting an existing WordPress folder ("Add a site using an existing
	// WordPress directory" / "a previously created site directory") both resolve
	// to the same flow: pointing the create-site form at a directory that already
	// contains a WordPress install. We simulate one by copying a freshly created
	// install into an unassociated folder, so the test stays cross-platform (no
	// reliance on the native delete dialog, which is mocked only on macOS).
	test( 'adds a site from an existing WordPress directory', async () => {
		test.setTimeout( 300_000 );

		const existingFolderName = 'existing-wp-dir';
		const existingDir = path.join( session.homePath, 'Studio', existingFolderName );
		await session.launch( { E2E_OPEN_FOLDER_DIALOG: existingDir } );

		const onboarding = new Onboarding( session.mainWindow );
		const { localPath: originalPath } = await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const originalSite = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( originalSite.runningButton ).toBeAttached( { timeout: 120_000 } );

		// Copy the full install into a folder not yet associated with any site.
		await fs.copy( originalPath, existingDir );

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();
		await addSiteFromSelectedPath( modal, 'Adopted Site', existingFolderName );

		const adoptedSite = new SiteContent( session.mainWindow, 'Adopted Site' );
		await expect( adoptedSite.siteNameHeading ).toHaveText( 'Adopted Site', { timeout: 120_000 } );
		await expect( adoptedSite.runningButton ).toBeAttached( { timeout: 120_000 } );

		// It adopted the existing directory rather than scaffolding a new one.
		const cliConfig = await fs.readJson( path.join( session.cliConfigPath, 'cli.json' ) );
		const adopted = cliConfig.sites.find( ( s: { name: string } ) => s.name === 'Adopted Site' );
		expect( adopted ).toBeDefined();
		expect( arePathsEqual( adopted.path, existingDir ) ).toBe( true );
		expect( await pathExists( path.join( existingDir, 'wp-config.php' ) ) ).toBe( true );
	} );

	test( 'preserves an existing MySQL wp-config.php when adding a WordPress directory', async () => {
		test.setTimeout( 300_000 );

		const existingFolderName = 'mysql-wp-dir';
		const existingDir = path.join( session.homePath, 'Studio', existingFolderName );
		await session.launch( { E2E_OPEN_FOLDER_DIALOG: existingDir } );

		const onboarding = new Onboarding( session.mainWindow );
		const { localPath: originalPath } = await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();

		const originalSite = new SiteContent( session.mainWindow, DEFAULT_SITE_NAME );
		await expect( originalSite.runningButton ).toBeAttached( { timeout: 120_000 } );

		await fs.copy( originalPath, existingDir );

		// Configure the existing wp-config.php for a real MySQL database. The custom
		// connection identity (host/user/password) must survive adoption — Studio
		// must not wipe a user's existing MySQL configuration.
		const wpConfigPath = path.join( existingDir, 'wp-config.php' );
		const originalConfig = await fs.readFile( wpConfigPath, 'utf-8' );
		const mysqlDefines = [
			"define( 'DB_NAME', 'my_production_db' );",
			"define( 'DB_USER', 'wp_user' );",
			"define( 'DB_PASSWORD', 'super-secret-pw' );",
			"define( 'DB_HOST', 'mysql.example.com' );",
		].join( '\n' );
		await fs.writeFile(
			wpConfigPath,
			originalConfig.replace( '<?php', `<?php\n${ mysqlDefines }\n` ),
			'utf-8'
		);

		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();
		await addSiteFromSelectedPath( modal, 'MySQL WP Site', existingFolderName );

		const adoptedSite = new SiteContent( session.mainWindow, 'MySQL WP Site' );
		await expect( adoptedSite.siteNameHeading ).toHaveText( 'MySQL WP Site', { timeout: 120_000 } );
		await expect( adoptedSite.runningButton ).toBeAttached( { timeout: 120_000 } );

		// The custom connection constants are preserved. Note Studio deliberately
		// normalizes DB_NAME to 'wordpress' because its SQLite driver requires a
		// non-empty DB_NAME at runtime (see apps/cli/lib/run-wp-cli-command.ts), so
		// we assert on the connection identity rather than DB_NAME.
		const finalConfig = await fs.readFile( wpConfigPath, 'utf-8' );
		expect( finalConfig ).toContain( "define( 'DB_USER', 'wp_user' );" );
		expect( finalConfig ).toContain( "define( 'DB_PASSWORD', 'super-secret-pw' );" );
		expect( finalConfig ).toContain( "define( 'DB_HOST', 'mysql.example.com' );" );
	} );

	test( 'duplicates a site from site settings', async () => {
		const { siteName } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const settingsTab = await siteContent.navigateToTab( 'settings' );
		await settingsTab.openDuplicateSite();

		const expectedCopyName = `${ siteName } Copy`;
		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( expectedCopyName ) ).toBeVisible( {
			timeout: 120_000,
		} );

		const copiedSiteContent = new SiteContent( session.mainWindow, expectedCopyName );
		await expect( copiedSiteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const cliConfig = await fs.readJson( path.join( session.cliConfigPath, 'cli.json' ) );
		const copiedSite = cliConfig.sites.find(
			( s: { name: string } ) => s.name === expectedCopyName
		);
		expect( copiedSite ).toBeDefined();
		expect( await pathExists( path.join( copiedSite.path, 'wp-config.php' ) ) ).toBe( true );
	} );
} );

test.describe( 'Sites without cleanup in-between', () => {
	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'copy site creates a duplicate with all files and thumbnail', async () => {
		const { siteName } = await completeOnboardingWithParams();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const cliConfigFile = path.join( session.cliConfigPath, 'cli.json' );
		const cliConfig = await fs.readJson( cliConfigFile );
		const site = cliConfig.sites.find( ( s: { name: string } ) => s.name === siteName );
		const siteId = site.id;

		const thumbnailsDir = path.join( session.appDataPath, 'Studio', 'thumbnails' );
		await fs.ensureDir( thumbnailsDir );
		const sourceThumbnailPath = path.join( thumbnailsDir, `${ siteId }.png` );
		await fs.writeFile( sourceThumbnailPath, 'test-thumbnail-data' );

		// Trigger copy via IPC (bypassing native menu since Playwright can't interact with it)
		// Use getFocusedWindow() instead of getAllWindows()[0] because the thumbnail
		// capture feature creates hidden BrowserWindows that can appear at index 0.
		await session.electronApp.evaluate(
			( { BrowserWindow }, { siteId } ) => {
				const mainWindow =
					BrowserWindow.getFocusedWindow() ??
					BrowserWindow.getAllWindows().find( ( w ) => w.isVisible() ) ??
					BrowserWindow.getAllWindows()[ 0 ];
				mainWindow.webContents.send( 'site-context-menu-action', {
					action: 'copy-site',
					siteId,
				} );
			},
			{ siteId }
		);

		const expectedCopyName = `${ siteName } Copy`;
		const sidebar = new MainSidebar( session.mainWindow );
		await expect( sidebar.getSiteNavButton( expectedCopyName ) ).toBeVisible( {
			timeout: 120_000,
		} );

		const copiedSiteContent = new SiteContent( session.mainWindow, expectedCopyName );
		await expect( copiedSiteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		const updatedCliConfig = await fs.readJson( cliConfigFile );
		const copiedSite = updatedCliConfig.sites.find(
			( s: { name: string } ) => s.name === expectedCopyName
		);
		expect( copiedSite ).toBeDefined();

		expect( await pathExists( path.join( copiedSite.path, 'wp-config.php' ) ) ).toBe( true );

		const copiedThumbnailPath = path.join( thumbnailsDir, `${ copiedSite.id }.png` );
		expect( await pathExists( copiedThumbnailPath ) ).toBe( true );
	} );

	test( 'stop all sites and then start the first site again', async () => {
		const sidebar = new MainSidebar( session.mainWindow );
		const stopAllButton = sidebar.getStopAllButton();
		await stopAllButton.click();

		const noSitesRunningText = sidebar.locator.getByText( 'No sites running' );
		await expect( noSitesRunningText ).toBeAttached( { timeout: 120_000 } );

		const firstSiteInSidebar = sidebar.locator.getByRole( 'button' ).first();
		const siteName = await firstSiteInSidebar.textContent();
		expect( siteName ).not.toBeNull();
		const siteContent = new SiteContent( session.mainWindow, siteName as string );

		const startButton = siteContent.locator.getByRole( 'button', { name: 'Start' } );
		await startButton.click();
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
	} );
} );
