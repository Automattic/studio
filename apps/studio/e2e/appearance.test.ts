import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import UserSettingsModal from './page-objects/user-settings-modal';

test.describe( 'Appearance', () => {
	const session = new E2ESession();

	const openSettings = async ( page: typeof session.mainWindow ) => {
		const settingsButton = page.getByTestId( 'settings-button' );
		await expect( settingsButton ).toBeVisible();
		await settingsButton.click();
	};

	test.beforeAll( async () => {
		await session.launch();
		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding();
		await onboarding.closeWhatsNew();
		const siteContent = new SiteContent( session.mainWindow, 'My WordPress Website' );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'changes color scheme from settings', async () => {
		await openSettings( session.mainWindow );
		const settings = new UserSettingsModal( session.mainWindow );
		await expect( settings.locator ).toBeVisible( { timeout: 10_000 } );

		// Preferences tab should be active by default with appearance radio group visible
		await expect( settings.appearanceRadioGroup ).toBeVisible();

		// Default should be Light
		await expect( settings.getAppearanceOption( 'Light' ) ).toHaveAttribute(
			'aria-checked',
			'true'
		);

		// Switch to Dark
		await settings.selectColorScheme( 'Dark' );
		const isDark = await session.electronApp.evaluate(
			( { nativeTheme } ) => nativeTheme.shouldUseDarkColors
		);
		expect( isDark ).toBe( true );

		// Switch to Light
		await settings.selectColorScheme( 'Light' );
		const isLight = await session.electronApp.evaluate(
			( { nativeTheme } ) => nativeTheme.shouldUseDarkColors
		);
		expect( isLight ).toBe( false );

		// Switch back to Light
		await settings.selectColorScheme( 'Light' );
		await expect( settings.getAppearanceOption( 'Light' ) ).toHaveAttribute(
			'aria-checked',
			'true'
		);

		await settings.close();
	} );

	test( 'persists color scheme across app restart', async () => {
		// Select Dark
		await openSettings( session.mainWindow );
		const settings = new UserSettingsModal( session.mainWindow );
		await expect( settings.locator ).toBeVisible( { timeout: 10_000 } );
		await settings.selectColorScheme( 'Dark' );
		await settings.close();

		// Restart the app
		await session.restart();
		await session.mainWindow.waitForLoadState( 'domcontentloaded' );

		const onboarding = new Onboarding( session.mainWindow );
		try {
			const visible = await onboarding.heading.isVisible( { timeout: 2000 } );
			if ( visible ) {
				await onboarding.completeOnboarding();
			}
		} catch ( error ) {
			// Onboarding not visible, continue with test
		}

		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, 'My WordPress Website' );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );

		// Verify Dark is still selected
		await openSettings( session.mainWindow );
		const settingsAfterRestart = new UserSettingsModal( session.mainWindow );
		await expect( settingsAfterRestart.locator ).toBeVisible( { timeout: 10_000 } );
		await expect( settingsAfterRestart.getAppearanceOption( 'Dark' ) ).toHaveAttribute(
			'aria-checked',
			'true'
		);

		// Reset to Light for other tests
		await settingsAfterRestart.selectColorScheme( 'Light' );
		await settingsAfterRestart.close();
	} );
} );
