import { test, expect } from '@playwright/test';
import { SITE_RUNTIME_PLAYGROUND } from '@studio/common/lib/site-runtime';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';

test.describe( 'Sandbox runtime', () => {
	const session = new E2ESession();

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		await session.cleanup();
	} );

	test( 'create and run a site with the Sandbox runtime', async () => {
		// Playground sites download the PHP WASM build and WordPress on first
		// run, so allow extra room on top of the launch + onboarding steps.
		test.setTimeout( 300_000 );

		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		const { siteName } = await onboarding.completeOnboarding( {
			customSiteName: 'Sandbox-Site',
			runtime: SITE_RUNTIME_PLAYGROUND,
		} );
		await onboarding.closeWhatsNew();

		// The site boots under the Playground runtime.
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 180_000 } );
		await expect( siteContent.siteNameHeading ).toHaveText( siteName );

		// The Settings tab reports the site as running on the Sandbox runtime.
		const settingsTab = await siteContent.navigateToTab( 'settings' );
		await expect( settingsTab.phpRuntimeDisplay ).toContainText( 'Sandbox' );

		// The Sandbox site actually serves its home page over HTTP.
		await expect( siteContent.frontendButton ).toBeVisible();
		const frontendUrl = await siteContent.frontendButton.textContent();
		expect( frontendUrl ).not.toBeNull();
		const response = await fetch( `http://${ frontendUrl }` );
		expect( [ 200, 302 ] ).toContain( response.status );
		expect( response.headers.get( 'content-type' ) ).toMatch( /text\/html/ );
	} );
} );
