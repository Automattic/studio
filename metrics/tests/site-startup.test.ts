import { test, expect } from '@playwright/test';
import { E2ESession } from '../../e2e/e2e-helpers';
import MainSidebar from '../../e2e/page-objects/main-sidebar';
import Onboarding from '../../e2e/page-objects/onboarding';
import SiteContent from '../../e2e/page-objects/site-content';
import { median } from '../utils';

test.describe( 'Startup Metrics', () => {
	const results: Record< string, number[] > = {};
	const session = new E2ESession();
	const siteName = 'Performance-Test-Site';

	test.beforeAll( async () => {
		await session.launch();

		// Complete onboarding before tests
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
		await onboarding.continueButton.click();
	} );

	// eslint-disable-next-line no-empty-pattern
	test.afterAll( async ( {}, testInfo ) => {
		const medians = {};
		Object.keys( results ).map( ( metric ) => {
			medians[ metric ] = median( results[ metric ] );
		} );
		await testInfo.attach( 'results', {
			body: JSON.stringify( medians, null, 2 ),
			contentType: 'application/json',
		} );

		await session.cleanup();
	} );

	test( 'measure site creation and startup performance', async () => {
		// Create a new site first (without timing)
		const sidebar = new MainSidebar( session.mainWindow );
		const modal = await sidebar.openAddSiteModal();
		await modal.siteNameInput.fill( siteName );

		// Measure site creation time (includes initial startup time)
		const startTime = Date.now();
		await modal.addSiteButton.click();
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 60_000 } );
		const endTime = Date.now();
		const duration = endTime - startTime;
		results.siteCreation = [ duration ];

		results.siteStartup = [];
		// Measure server stop/start 5 times
		for ( let i = 0; i < 5; i++ ) {
			console.log( `Run ${ i + 1 }/5: Stopping and starting site` );
			// Stop the site by clicking the Running button
			await siteContent.runningButton.click();
			const startButton = siteContent.locator.getByRole( 'button', { name: 'Start' } );
			await expect( startButton ).toBeAttached( { timeout: 30_000 } );

			// Start timer
			const startTime = Date.now();
			await startButton.click();
			// Wait for site to be running
			await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
			const endTime = Date.now();
			const duration = endTime - startTime;

			// Log performance data for this run
			console.log( `Run ${ i + 1 }/5: Restart took ${ duration }ms` );
			results.siteStartup.push( duration );

			// Wait a moment before next cycle
			await session.mainWindow.waitForTimeout( 100 );
		}

		// Delete the site after test
		const settingsTab = await siteContent.navigateToTab( 'Settings' );
		await session.electronApp.evaluate( ( { dialog } ) => {
			dialog.showMessageBox = async () => {
				return { response: 0, checkboxChecked: true };
			};
		} );
		await settingsTab.openDeleteSiteModal();
		await session.mainWindow.waitForTimeout( 200 ); // Wait for deletion
	} );
} );
