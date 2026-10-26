import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import AddSite from './page-objects/add-site';
import AppSettings from './page-objects/app-settings';

test.describe( 'Studio settings', () => {
	const session = new E2ESession();
	const isDark = () =>
		session.electronApp.evaluate( ( { nativeTheme } ) => nativeTheme.shouldUseDarkColors );

	// Without sites, Add site opens on every launch.
	const closeAddSite = async () => {
		const addSite = new AddSite( session.mainWindow );
		await expect( addSite.dialog ).toBeVisible( { timeout: 60_000 } );
		await session.mainWindow.keyboard.press( 'Escape' );
		await expect( addSite.dialog ).toBeHidden();
	};

	test.beforeAll( async () => {
		await session.launch( {}, { appData: { agenticFeaturesEnabled: true } } );
		await closeAddSite();
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'applies the color scheme and instructions, and keeps them across a restart', async () => {
		const instructions = 'Use accessible WordPress patterns.';
		const settings = new AppSettings( session.mainWindow );
		await settings.open();
		await settings.showSection( 'Appearance' );
		await expect( settings.themeSelect ).toHaveText( 'System' );
		await settings.selectColorScheme( 'Dark' );
		await expect.poll( isDark ).toBe( true );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
			'data-color-scheme',
			'dark'
		);
		await settings.showSection( 'Instructions' );
		await settings.instructionsInput.fill( instructions );
		await settings.close();
		await expect.poll( async () => ( await session.getAppConfig() ).colorScheme ).toBe( 'dark' );

		await session.restart();
		await closeAddSite();
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
			'data-color-scheme',
			'dark'
		);
		expect( await isDark() ).toBe( true );
		const settingsAfterRestart = new AppSettings( session.mainWindow );
		await settingsAfterRestart.open();
		await settingsAfterRestart.showSection( 'Instructions' );
		await expect( settingsAfterRestart.instructionsInput ).toHaveValue( instructions );
		await settingsAfterRestart.showSection( 'Appearance' );
		await expect( settingsAfterRestart.themeSelect ).toHaveText( 'Dark' );
		await settingsAfterRestart.selectColorScheme( 'Light' );
		await expect.poll( isDark ).toBe( false );
	} );
} );
