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

async function expectStopped( siteName: string ) {
	await expect( new Sidebar( session.mainWindow ).getStatusButton( siteName ) ).toHaveAttribute(
		'data-state',
		'stopped',
		{ timeout: 120_000 }
	);
}

// The preview header folds its actions into a More menu when it runs out of room.
async function previewAction( menuItem: string, button = menuItem ) {
	const page = session.mainWindow;
	const inline = page.getByRole( 'button', { name: button, exact: true } );
	await expect( async () => {
		try {
			if ( await inline.isVisible() ) {
				// The address bar reveals its own actions on hover.
				await page.getByRole( 'textbox', { name: 'Address' } ).hover( { timeout: 2000 } );
				await inline.click( { timeout: 2000 } );
			} else {
				await page
					.getByRole( 'button', { name: 'More preview actions' } )
					.click( { timeout: 2000 } );
				await page.getByRole( 'menuitem', { name: menuItem, exact: true } ).click( {
					timeout: 2000,
				} );
			}
		} catch ( error ) {
			await page.keyboard.press( 'Escape' );
			throw error;
		}
	} ).toPass();
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
		await session.reportFailure( testInfo );
		await session.cleanup();
	} );

	test( 'creates a site, previews it, and keeps it across relaunches', async ( { page } ) => {
		const siteName = 'Lifecycle site';
		await session.launch();
		await new AddSite( session.mainWindow ).createSite( { siteName } );
		await new Sidebar( session.mainWindow ).expectRunning( siteName );
		const site = await session.waitForSite( siteName );
		expect(
			arePathsEqual( site.path, path.join( session.homePath, 'Studio', 'lifecycle-site' ) )
		).toBe( true );
		expect( await pathExists( path.join( site.path, 'wp-config.php' ) ) ).toBe( true );
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );

		const siteUrl = await session.getSiteUrl( siteName );
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin` ) );
		await expect( page.locator( '#wp-admin-bar-my-account' ) ).toBeVisible();

		await session.electronApp.evaluate( ( { shell } ) => {
			const captured = globalThis as typeof globalThis & { openedUrls: string[] };
			captured.openedUrls = [];
			shell.openExternal = async ( url ) => {
				captured.openedUrls.push( url );
			};
		} );
		await previewAction( 'Open in browser', 'Open this page in your browser' );
		const openedUrls = () =>
			session.electronApp.evaluate(
				() => ( globalThis as typeof globalThis & { openedUrls: string[] } ).openedUrls
			);
		await expect.poll( openedUrls ).toHaveLength( 1 );
		expect( new URL( ( await openedUrls() )[ 0 ] ).origin ).toBe( new URL( siteUrl ).origin );

		const guestId = await session.mainWindow
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		const loadInPreview = ( url: string ) =>
			session.electronApp.evaluate(
				async ( { webContents }, target ) => {
					await webContents
						.fromId( target.id )!
						.loadURL( target.url )
						.catch( () => {} );
				},
				{ id: guestId, url }
			);
		await loadInPreview( 'http://127.0.0.1:1/' );
		await expect( session.mainWindow.getByText( 'Preview could not load' ) ).toBeVisible();
		await loadInPreview( siteUrl );
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );

		await new Sidebar( session.mainWindow ).getStatusButton( siteName ).click();
		await expectStopped( siteName );
		await expect( session.mainWindow.locator( 'webview' ) ).toHaveCount( 0 );

		await session.restart();
		await expectStopped( siteName );
		await new Sidebar( session.mainWindow ).getStatusButton( siteName ).click();
		await new Sidebar( session.mainWindow ).expectRunning( siteName );
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );

		await session.mainWindow.evaluate( () =>
			window.ipcApi.setUserPreferences( { quitSitesBehavior: 'stop-and-auto-start' } )
		);
		await session.restart();
		await new Sidebar( session.mainWindow ).expectRunning( siteName );
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );
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

	// Pointing the create form at a folder that already holds WordPress adopts that install, and
	// Studio must not wipe the user's own MySQL connection settings while doing so.
	test( 'adds a site from an existing WordPress directory and keeps its MySQL wp-config.php', async () => {
		const { site: original } = await launchWithSite( session, { folder: 'original' } );
		const existingDir = await copyInstallTo( original.path, 'existing-wp-dir' );

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
			siteName: 'Adopted Site',
			pickFolder: true,
		} );
		await new Sidebar( session.mainWindow ).expectRunning( 'Adopted Site' );

		const adopted = await session.waitForSite( 'Adopted Site' );
		expect( arePathsEqual( adopted.path, existingDir ) ).toBe( true );
		const finalConfig = await fs.readFile( wpConfigPath, 'utf-8' );
		expect( finalConfig ).toContain( "define( 'DB_USER', 'wp_user' );" );
		expect( finalConfig ).toContain( "define( 'DB_PASSWORD', 'super-secret-pw' );" );
		expect( finalConfig ).toContain( "define( 'DB_HOST', 'mysql.example.com' );" );
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
} );

// Settings changes share one site. Changing the PHP version restarts it, so it runs last: the
// form re-seeds on the restart's site events, which would otherwise race the next test's input.
test.describe( 'Site settings', () => {
	let siteName: string;

	test.beforeAll( async () => {
		( { siteName } = await launchWithSite( session ) );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'saves a rename and the debug log back to back, and manages the agent instructions file', async () => {
		const newSiteName = 'E2E-Test-Site-Renamed';
		const page = session.mainWindow;

		const settings = new SiteSettings( page );
		await settings.open( siteName );
		await settings.siteNameInput.fill( newSiteName );
		await settings.showSection( 'Debug' );
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await page.getByRole( 'switch', { name: 'Debug log', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Discard', exact: true } ) ).toHaveCount( 0, {
			timeout: 120_000,
		} );
		await settings.close();

		await expect( new Sidebar( page ).getSiteButton( newSiteName ) ).toBeVisible();
		await expect
			.poll( () => session.waitForSite( newSiteName ), { timeout: 120_000 } )
			.toMatchObject( { enableDebugLog: true } );
		siteName = newSiteName;

		await settings.open( siteName );
		await settings.showSection( 'Debug' );
		await expect( page.getByRole( 'switch', { name: 'Debug log', exact: true } ) ).toBeChecked();
		await settings.showSection( 'Instructions' );
		const agentsFile = path.join( ( await session.waitForSite( siteName ) ).path, 'AGENTS.md' );
		await page.getByRole( 'button', { name: 'Actions for AGENTS.md', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Uninstall', exact: true } ).click();
		const agents = page.getByRole( 'switch', { name: 'AGENTS.md', exact: true } );
		await expect( agents ).not.toBeChecked();
		await expect.poll( () => pathExists( agentsFile ) ).toBe( false );
		await agents.click();
		await expect( agents ).toBeChecked();
		await expect.poll( () => pathExists( agentsFile ) ).toBe( true );
		await settings.close();
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
