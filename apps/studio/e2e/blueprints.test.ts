import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import { getUrlWithAutoLogin } from './utils';

const cases: {
	title: string;
	siteName: string;
	blueprint: string;
	adminPath: string;
	check: ( page: Page ) => Promise< void >;
}[] = [
	{
		title: 'installs a theme',
		siteName: 'Blueprint-Theme-Install',
		blueprint: 'install-theme.json',
		adminPath: '/wp-admin/themes.php',
		check: ( page ) =>
			expect( page.locator( '.theme[data-slug="twentytwentytwo"]' ) ).toBeVisible(),
	},
	{
		title: 'activates a theme',
		siteName: 'Blueprint-Theme-Activate',
		blueprint: 'activate-theme.json',
		adminPath: '/wp-admin/themes.php',
		check: ( page ) =>
			expect( page.locator( '.theme.active' ) ).toHaveAttribute( 'data-slug', 'twentytwentyone' ),
	},
	{
		title: 'installs a plugin',
		siteName: 'Blueprint-Plugin-Install',
		blueprint: 'install-plugin.json',
		adminPath: '/wp-admin/plugins.php',
		check: ( page ) => expect( page.locator( 'tr[data-slug="akismet"]' ) ).toBeVisible(),
	},
	{
		title: 'activates a plugin',
		siteName: 'Blueprint-Plugin-Activate',
		blueprint: 'activate-plugin.json',
		adminPath: '/wp-admin/plugins.php',
		check: ( page ) =>
			expect( page.locator( 'tr[data-slug="hello-dolly"].active' ) ).toBeVisible( {
				timeout: 60_000,
			} ),
	},
	{
		title: 'runs PHP code',
		siteName: 'Blueprint-PHP-Code',
		blueprint: 'run-php-code.json',
		adminPath: '/wp-admin/options-general.php',
		check: ( page ) => expect( page.getByLabel( 'Site Title' ) ).toBeVisible(),
	},
	{
		title: 'runs WP-CLI commands',
		siteName: 'Blueprint-WP-CLI',
		blueprint: 'wp-cli-command.json',
		adminPath: '/wp-admin/options-general.php',
		check: ( page ) => expect( page.getByLabel( 'Site Title' ) ).toBeVisible(),
	},
];

test.describe( 'Blueprints', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch();
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		// Run one site at a time to keep peak memory low on constrained hosts.
		await session.mainWindow.evaluate( () => window.ipcApi.stopAllServers() );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	for ( const { title, siteName, blueprint, adminPath, check } of cases ) {
		test( `create site with Blueprint that ${ title }`, async ( { page } ) => {
			await new AddSite( session.mainWindow ).createSite( {
				siteName,
				blueprintPath: path.join( __dirname, 'fixtures', 'blueprints', blueprint ),
			} );
			await new Sidebar( session.mainWindow ).expectRunning( siteName );

			const siteUrl = await session.getSiteUrl( siteName );
			await page.goto( getUrlWithAutoLogin( `${ siteUrl }${ adminPath }` ) );
			await check( page );
		} );
	}
} );
