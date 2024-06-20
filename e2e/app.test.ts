import { test, expect } from '@playwright/test';
import packageJson from '../package.json';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';

test.describe( 'Electron app', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch();
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'should ensure app title is correct.', async () => {
		const title = await session.mainWindow.title();
		expect( title ).toBe( packageJson.productName );
	} );

	test( 'first screen displayed is onboarding', async () => {
		const onboarding = new Onboarding( session.mainWindow );
		await expect( onboarding.heading ).toBeVisible();
	} );
} );
