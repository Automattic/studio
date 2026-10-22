import path from 'path';
import { test, expect } from '@playwright/test';
import { arePathsEqual, pathExists, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import {
	RecommendedPHPVersion as DEFAULT_PHP_VERSION,
	SupportedPHPVersions as ALLOWED_PHP_VERSIONS,
} from '@studio/common/types/php-versions';
import fs from 'fs-extra';
import { E2ESession, launchWithSite } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import SiteSettings from './page-objects/site-settings';
import { getUrlWithAutoLogin } from './utils';

const skipTestOnWindows = process.platform === 'win32' ? test.skip : test;
const session = new E2ESession();

async function deleteSite( siteName: string, { keepFiles }: { keepFiles: boolean } ) {
	await new Sidebar( session.mainWindow ).openContextMenuItem( siteName, 'Delete site' );
	const dialog = session.mainWindow.getByRole( 'alertdialog' );
	const deleteFiles = dialog.getByRole( 'checkbox', {
		name: 'Also move files and database to Trash',
	} );
	await deleteFiles.setChecked( ! keepFiles );
	await dialog.getByRole( 'button', { name: 'Remove site' } ).click();
	await expect( new Sidebar( session.mainWindow ).getSiteButton( siteName ) ).not.toBeAttached( {
		timeout: 30_000,
	} );
}

// Copies a running site's install into `~/Studio/<folder>`, a folder no site uses yet. The source
// is running, so recursiveCopyDirectory (unlike fs.copy) tolerates its SQLite journal/cache files
// vanishing mid-copy.
async function copyInstallTo( sourcePath: string, folder: string ) {
	const target = path.join( session.homePath, 'Studio', folder );
	await recursiveCopyDirectory( sourcePath, target );
	return target;
}

test.describe( 'Sites', () => {
	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		await session.cleanup();
	} );

	// The default name and folder, and a custom name with a custom folder.
	[
		[ undefined, undefined ],
		[ 'E2E-Test-Site 2', 'hello' ],
	].forEach( ( [ customSiteName, customFolderName ] ) => {
		test( `create site with name ${ customSiteName } and path ${ customFolderName }`, async () => {
			const { siteName, site } = await launchWithSite( session, {
				siteName: customSiteName,
				folder: customFolderName,
			} );

			if ( customSiteName ) {
				expect( siteName ).toBe( customSiteName );
			}
			if ( customFolderName ) {
				expect(
					arePathsEqual( site.path, path.join( session.homePath, 'Studio', customFolderName ) )
				).toBe( true );
			}
			expect( await pathExists( path.join( site.path, 'wp-config.php' ) ) ).toBe( true );

			const response = await fetch( await session.getSiteUrl( siteName ) );
			expect( [ 200, 302 ] ).toContain( response.status );
			expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
		} );
	} );

	skipTestOnWindows( 'delete site but keep directory on disk', async () => {
		const { siteName, site } = await launchWithSite( session );

		await deleteSite( siteName, { keepFiles: true } );

		expect( await pathExists( path.join( site.path, 'wp-config.php' ) ) ).toBe( true );
	} );

	skipTestOnWindows( 'delete site and remove directory from disk', async () => {
		const { siteName, site } = await launchWithSite( session );

		await deleteSite( siteName, { keepFiles: false } );

		await expect.poll( () => pathExists( site.path ) ).toBe( false );
	} );

	// Pointing the create form at a folder that already holds WordPress adopts that install.
	test( 'adds a site from an existing WordPress directory', async () => {
		const folder = 'existing-wp-dir';
		const { site: original } = await launchWithSite( session, { folder: 'original' } );
		const existingDir = await copyInstallTo( original.path, folder );
		await session.restart( { E2E_OPEN_FOLDER_DIALOG: existingDir } );

		await new AddSite( session.mainWindow ).createSite( {
			siteName: 'Adopted Site',
			pickFolder: true,
		} );
		await new Sidebar( session.mainWindow ).expectRunning( 'Adopted Site' );

		const adopted = await session.waitForSite( 'Adopted Site' );
		expect( arePathsEqual( adopted.path, existingDir ) ).toBe( true );
		expect( await pathExists( path.join( existingDir, 'wp-config.php' ) ) ).toBe( true );
	} );

	// Studio must not wipe a user's own MySQL connection settings when adopting their install.
	test( 'preserves an existing MySQL wp-config.php when adding a WordPress directory', async () => {
		const { site: original } = await launchWithSite( session, { folder: 'original' } );
		const existingDir = await copyInstallTo( original.path, 'mysql-wp-dir' );

		const wpConfigPath = path.join( existingDir, 'wp-config.php' );
		const mysqlDefines = [
			"define( 'DB_NAME', 'my_production_db' );",
			"define( 'DB_USER', 'wp_user' );",
			"define( 'DB_PASSWORD', 'super-secret-pw' );",
			"define( 'DB_HOST', 'mysql.example.com' );",
		].join( '\n' );
		const originalConfig = await fs.readFile( wpConfigPath, 'utf-8' );
		await fs.writeFile(
			wpConfigPath,
			originalConfig.replace( '<?php', `<?php\n${ mysqlDefines }\n` ),
			'utf-8'
		);
		await session.restart( { E2E_OPEN_FOLDER_DIALOG: existingDir } );

		await new AddSite( session.mainWindow ).createSite( {
			siteName: 'MySQL WP Site',
			pickFolder: true,
		} );
		await new Sidebar( session.mainWindow ).expectRunning( 'MySQL WP Site' );

		const finalConfig = await fs.readFile( wpConfigPath, 'utf-8' );
		expect( finalConfig ).toContain( "define( 'DB_USER', 'wp_user' );" );
		expect( finalConfig ).toContain( "define( 'DB_PASSWORD', 'super-secret-pw' );" );
		expect( finalConfig ).toContain( "define( 'DB_HOST', 'mysql.example.com' );" );
	} );
} );

// Settings changes share one site. Changing the PHP version restarts it, so it runs last: the
// form re-seeds on the restart's site events, which would otherwise race the next test's input.
test.describe( 'Site settings', () => {
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

	test( "edit site's settings in wp-admin", async ( { page } ) => {
		const siteUrl = await session.getSiteUrl( siteName );

		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/options-general.php` ) );
		const siteTitleInput = page.getByLabel( 'Site Title' );
		await siteTitleInput.fill( 'testing site title' );
		await siteTitleInput.press( 'Enter' );

		await page.goto( siteUrl );
		expect( await page.title() ).toBe( 'testing site title' );
	} );

	test( 'renames a site', async () => {
		const newSiteName = 'E2E-Test-Site-Renamed';

		const settings = new SiteSettings( session.mainWindow );
		await settings.open( siteName );
		await settings.siteNameInput.fill( newSiteName );
		await settings.saveSettings();
		await settings.close();

		await expect( new Sidebar( session.mainWindow ).getSiteButton( newSiteName ) ).toBeVisible();
		await session.waitForSite( newSiteName );
		siteName = newSiteName;
	} );

	test( 'change PHP version', async () => {
		const newPhpVersion = ALLOWED_PHP_VERSIONS.find( ( v ) => v !== DEFAULT_PHP_VERSION ) || '8.2';

		const settings = new SiteSettings( session.mainWindow );
		await settings.open( siteName );
		await settings.showSection( 'PHP' );
		await expect( settings.phpVersionSelect ).toHaveText( DEFAULT_PHP_VERSION );

		await settings.selectPhpVersion( newPhpVersion );
		await settings.saveSettings();

		await expect
			.poll( async () => await session.waitForSite( siteName ) )
			.toMatchObject( { phpVersion: newPhpVersion } );
		await expect( settings.phpVersionSelect ).toHaveText( newPhpVersion );
	} );
} );

test.describe( 'Sites without cleanup in-between', () => {
	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'duplicating from the sidebar copies all files and the thumbnail', async () => {
		const { siteName, site } = await launchWithSite( session );

		const thumbnailsDir = path.join( session.appDataPath, 'Studio', 'thumbnails' );
		await fs.ensureDir( thumbnailsDir );
		await fs.writeFile( path.join( thumbnailsDir, `${ site.id }.png` ), 'test-thumbnail-data' );

		await new Sidebar( session.mainWindow ).openContextMenuItem( siteName, 'Duplicate' );

		const copyName = `${ siteName } Copy`;
		await expect( new Sidebar( session.mainWindow ).getSiteButton( copyName ) ).toBeVisible( {
			timeout: 120_000,
		} );
		const copy = await session.waitForSite( copyName );
		expect( await pathExists( path.join( copy.path, 'wp-config.php' ) ) ).toBe( true );
		await expect
			.poll( () => pathExists( path.join( thumbnailsDir, `${ copy.id }.png` ) ) )
			.toBe( true );
	} );

	test( 'stop all sites and then start the first site again', async () => {
		const sidebar = new Sidebar( session.mainWindow );
		await session.stopAllSites();

		const [ first ] = await session.getSites();
		await expect( sidebar.getStatusButton( first.name ) ).toHaveAttribute(
			'data-state',
			'stopped',
			{
				timeout: 120_000,
			}
		);

		await sidebar.getStatusButton( first.name ).click();
		await sidebar.expectRunning( first.name );
	} );
} );
