import { test, expect } from '@playwright/test';
import packageJson from '../package.json';
import { launchApp } from './e2e-helpers';
import type { ElectronApplication, Page } from 'playwright';

test.describe( 'Electron app', () => {
	let electronApp: ElectronApplication;
	let mainWindow: Page;

	test.beforeAll( async () => {
		[ electronApp, mainWindow ] = await launchApp();
	} );

	test.afterAll( async () => {
		await electronApp?.close();
	} );

	test( 'should ensure app title is correct.', async () => {
		const title = await mainWindow.title();
		expect( title ).toBe( packageJson.productName );
	} );
} );
