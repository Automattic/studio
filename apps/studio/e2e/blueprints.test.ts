import path from 'path';
import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import { getUrlWithAutoLogin } from './utils';

/**
 * Creating a site from a Blueprint file picked in the Add Site form. The app
 * hands the file to `studio site create --blueprint`, so what each Blueprint
 * step does is covered by apps/cli/commands/site/tests/create-blueprint.e2e.test.ts;
 * this test covers the form's Blueprint option reaching it.
 */
test.describe( 'Blueprints', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch();
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'create site with a Blueprint that installs and activates a theme', async ( { page } ) => {
		const siteName = 'Blueprint-Theme-Activate';
		await new AddSite( session.mainWindow ).createSite( {
			siteName,
			blueprintPath: path.join( __dirname, 'fixtures', 'blueprints', 'activate-theme.json' ),
		} );
		await new Sidebar( session.mainWindow ).expectRunning( siteName );

		const siteUrl = await session.getSiteUrl( siteName );
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/themes.php` ) );
		await expect( page.locator( '.theme.active' ) ).toHaveAttribute(
			'data-slug',
			'twentytwentyone'
		);
	} );
} );
