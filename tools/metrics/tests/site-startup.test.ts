import { test, expect } from '@playwright/test';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';
import AddSite from '../../../apps/studio/e2e/page-objects/add-site';
import Sidebar from '../../../apps/studio/e2e/page-objects/sidebar';
import { median } from '../utils';

test.describe( 'Startup Metrics', () => {
	const results: Record< string, number[] > = {};
	const session = new E2ESession();
	const siteName = 'Performance-Test-Site';

	test.beforeAll( async () => {
		await session.launch();
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
		const sidebar = new Sidebar( session.mainWindow );
		const statusButton = sidebar.getStatusButton( siteName );

		// Measure site creation time (includes initial startup time)
		await test.step( 'Measure site creation time', async () => {
			const addSite = new AddSite( session.mainWindow );
			await addSite.open();
			const startTime = Date.now();
			await addSite.createSite( { siteName } );
			await sidebar.expectRunning( siteName );
			results.siteCreation = [ Date.now() - startTime ];
		} );

		results.siteStartup = [];
		// Measure server stop/start 5 times
		for ( let i = 0; i < 5; i++ ) {
			await test.step( `Run ${ i + 1 }/5: Stopping and starting site`, async () => {
				await statusButton.click();
				await expect( statusButton ).toHaveAttribute( 'data-state', 'stopped', {
					timeout: 120_000,
				} );

				const startTime = Date.now();
				await statusButton.click();
				await sidebar.expectRunning( siteName );
				const duration = Date.now() - startTime;

				console.log( `Run ${ i + 1 }/5: Restart took ${ duration }ms` );
				results.siteStartup.push( duration );

				// Wait a moment before next cycle
				await session.mainWindow.waitForTimeout( 100 );
			} );
		}
	} );
} );
