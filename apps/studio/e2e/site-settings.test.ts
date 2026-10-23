import { test, expect } from '@playwright/test';
import {
	RecommendedPHPVersion as DEFAULT_PHP_VERSION,
	SupportedPHPVersions as ALLOWED_PHP_VERSIONS,
} from '@studio/common/types/php-versions';
import { E2ESession, launchWithSite } from './e2e-helpers';
import Sidebar from './page-objects/sidebar';
import SiteSettings from './page-objects/site-settings';
import { getUrlWithAutoLogin } from './utils';

const session = new E2ESession();

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
