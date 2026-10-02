import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';

test.describe( 'Electron app', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch( {}, { firstRun: true } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'should ensure app title is correct.', async () => {
		expect( await session.mainWindow.title() ).toBe( 'Studio' );
	} );

	test( 'first screen displayed is onboarding', async () => {
		await expect(
			session.mainWindow.getByRole( 'heading', { name: 'WordPress Studio', level: 1 } )
		).toBeVisible();
		await session.mainWindow.getByRole( 'button', { name: 'Skip' } ).click();
		await session.mainWindow.getByRole( 'button', { name: 'Continue' } ).click();
		await session.mainWindow.getByRole( 'button', { name: 'Skip log in' } ).click();
		await expect(
			session.mainWindow.getByRole( 'heading', { name: 'Add a site', level: 1 } )
		).toBeVisible();
	} );
} );
