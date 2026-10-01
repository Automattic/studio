import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import AppSettings from './page-objects/app-settings';

test.describe( 'Appearance', () => {
	const session = new E2ESession();
	const isDark = () =>
		session.electronApp.evaluate( ( { nativeTheme } ) => nativeTheme.shouldUseDarkColors );

	test.beforeAll( async () => {
		await session.launch();
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'changes color scheme from settings', async () => {
		const settings = new AppSettings( session.mainWindow );
		await settings.open();
		await expect( settings.appearanceOption( 'Light' ) ).toHaveAttribute( 'aria-pressed', 'true' );

		await settings.selectColorScheme( 'Dark' );
		await expect.poll( isDark ).toBe( true );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
			'data-color-scheme',
			'dark'
		);

		await settings.selectColorScheme( 'Light' );
		await expect.poll( isDark ).toBe( false );
		await settings.close();
	} );

	test( 'persists color scheme across app restart', async () => {
		const settings = new AppSettings( session.mainWindow );
		await settings.open();
		await settings.selectColorScheme( 'Dark' );

		await session.restart();
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
			'data-color-scheme',
			'dark'
		);

		const settingsAfterRestart = new AppSettings( session.mainWindow );
		await settingsAfterRestart.open();
		await expect( settingsAfterRestart.appearanceOption( 'Dark' ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await settingsAfterRestart.selectColorScheme( 'Light' );
	} );
} );
