import { test, expect } from '@playwright/test';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { E2ESession } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import SiteOverview from './page-objects/site-overview';

test.describe( 'Sandbox runtime', () => {
	const session = new E2ESession();

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		await session.cleanup();
	} );

	test( 'create and run a site with the Sandbox runtime', async () => {
		// Playground sites download the PHP WASM build and WordPress on first
		// run, so allow extra room on top of the launch + create steps.
		test.setTimeout( 300_000 );

		await session.launch();
		const siteName = await new AddSite( session.mainWindow ).createSite( {
			siteName: 'Sandbox-Site',
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		await new Sidebar( session.mainWindow ).expectRunning( siteName, 180_000 );

		const overview = new SiteOverview( session.mainWindow );
		await overview.open( siteName, 'Settings' );
		await expect( overview.runtimeRadio( 'Sandbox' ) ).toBeChecked();

		const response = await fetch( await session.getSiteUrl( siteName ) );
		expect( [ 200, 302 ] ).toContain( response.status );
		expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
	} );
} );
