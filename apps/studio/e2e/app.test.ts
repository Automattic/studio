import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';

test.describe( 'Electron app', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch( {}, { firstRun: true } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'first launch welcomes, then opens Add site', async () => {
		expect( await session.mainWindow.title() ).toBe( 'WordPress Studio' );
		const welcome = session.mainWindow.getByRole( 'alertdialog', {
			name: 'Welcome to WordPress Studio',
		} );
		await expect( welcome ).toBeVisible();
		await welcome.getByRole( 'button', { name: 'Continue without an account' } ).click();
		await expect( session.mainWindow.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
	} );
} );
