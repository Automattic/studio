import { test, expect } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { _electron as electron, ElectronApplication, Page } from 'playwright';
import packageJson from '../package.json';

test.describe( 'Electron app', () => {
	let electronApp: ElectronApplication;
	let mainWindow: Page;

	test.beforeAll( async () => {
		// find the latest build in the out directory
		const latestBuild = findLatestBuild();
		// parse the packaged Electron app and find paths and other info
		const appInfo = parseElectronApp( latestBuild );
		electronApp = await electron.launch( {
			args: [ appInfo.main ], // main file from package.json
			executablePath: appInfo.executable, // path to the Electron executable
		} );
		mainWindow = await electronApp.firstWindow();
	} );

	test.afterAll( async () => {
		await electronApp.close();
	} );

	test( 'should ensure app title is correct.', async () => {
		const title = await mainWindow.title();
		expect( title ).toBe( packageJson.productName );
	} );
} );
