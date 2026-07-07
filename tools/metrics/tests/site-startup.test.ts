import { test, expect } from '@playwright/test';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';
import Onboarding from '../../../apps/studio/e2e/page-objects/onboarding';
import SiteContent from '../../../apps/studio/e2e/page-objects/site-content';
import WhatsNewModal from '../../../apps/studio/e2e/page-objects/whats-new-modal';
import { median } from '../utils';

test.describe( 'Startup Metrics', () => {
	const results: Record< string, number[] > = {};
	const session = new E2ESession();
	const siteName = 'Performance-Test-Site';

	test.beforeAll( async () => {
		await session.launch();

		// Complete onboarding before tests
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
		setTimeout( () => process.exit( 0 ), 1000 );
	} );

	test( 'measure site creation and startup performance', async () => {
		let siteContent;

		// Measure site creation time (includes initial startup time)
		await test.step( 'Measure site creation time', async () => {
			const onboarding = new Onboarding( session.mainWindow );
			await expect( onboarding.heading ).toBeVisible();
			const startTime = Date.now();
			await onboarding.completeOnboarding();
			await onboarding.closeWhatsNew();

			siteContent = new SiteContent( session.mainWindow, siteName );
			await expect( siteContent.runningButton ).toBeAttached();
			const endTime = Date.now();
			const duration = endTime - startTime;
			results.siteCreation = [ duration ];
		} );

		results.siteStartup = [];
		// Measure server stop/start 5 times
		for ( let i = 0; i < 5; i++ ) {
			await test.step( `Run ${ i + 1 }/5: Stopping and starting site`, async () => {
				// Stop the site by clicking the Running button
				await siteContent.runningButton.click();
				const startButton = siteContent.locator.getByRole( 'button', { name: 'Start' } );
				await expect( startButton ).toBeAttached();

				// Start timer
				const startTime = Date.now();
				await startButton.click();
				// Wait for site to be running
				await expect( siteContent.runningButton ).toBeAttached();
				const endTime = Date.now();
				const duration = endTime - startTime;

				// Log performance data for this run
				console.log( `Run ${ i + 1 }/5: Restart took ${ duration }ms` );
				results.siteStartup.push( duration );

				// Wait a moment before next cycle
				await session.mainWindow.waitForTimeout( 100 );
			} );
		}

		// Delete the site after test
		await test.step( 'Delete the site', async () => {
			const settingsTab = await siteContent.navigateToTab( 'settings' );
			await session.electronApp.evaluate( ( { dialog } ) => {
				dialog.showMessageBox = async () => {
					return { response: 0, checkboxChecked: true };
				};
			} );
			await settingsTab.openDeleteSiteModal();
			await session.mainWindow.waitForTimeout( 200 ); // Wait for deletion
		} );
	} );
} );
