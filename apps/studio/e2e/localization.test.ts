import { test, expect } from '@playwright/test';
import { E2ESession, launchWithSite } from './e2e-helpers';
import AppSettings from './page-objects/app-settings';
import Sidebar from './page-objects/sidebar';
import { getUrlWithAutoLogin } from './utils';

test.describe( 'Localization', () => {
	const session = new E2ESession();
	let current = 'English';

	// Labels are translated, so the settings are opened from the app menu and closed with Escape.
	const changeLanguage = async ( nativeName: string, lang: string ) => {
		const settings = new AppSettings( session.mainWindow );
		await settings.openFromAppMenu( session.electronApp );
		await settings.selectLanguage( current, nativeName, lang );
		current = nativeName;
		await session.mainWindow.keyboard.press( 'Escape' );
	};

	test.beforeAll( async () => {
		await launchWithSite( session );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
		if ( current !== 'English' ) {
			await changeLanguage( 'English', 'en' );
		}
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'changes language from settings', async () => {
		await changeLanguage( 'Français', 'fr' );
		await expect(
			session.mainWindow.getByRole( 'button', { name: 'Ajouter un site' } )
		).toBeVisible();
		await changeLanguage( 'English', 'en' );
		await expect( session.mainWindow.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
	} );

	test( 'supports RTL languages', async () => {
		await changeLanguage( 'العربية', 'ar' );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute( 'dir', 'rtl' );
		await expect( session.mainWindow.getByRole( 'button', { name: 'إضافة موقع' } ) ).toBeVisible();

		await changeLanguage( 'English', 'en' );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute( 'dir', 'ltr' );
	} );

	test( 'persists selected language when re-opening app', async () => {
		await changeLanguage( 'Deutsch', 'de' );
		await session.restart();
		await expect(
			session.mainWindow.getByRole( 'button', { name: 'Website hinzufügen' } )
		).toBeVisible();
	} );

	test( 'created site language matches Studio language', async ( { page } ) => {
		const siteName = 'Localized-Site-Test';
		await changeLanguage( '日本語', 'ja' );

		await session.mainWindow.getByRole( 'button', { name: 'サイトを追加' } ).click();
		await session.mainWindow.locator( 'a[href$="onboarding/create"]' ).click();
		await session.mainWindow.getByRole( 'textbox' ).first().fill( siteName );
		await session.mainWindow.getByTestId( 'create-site-submit' ).click();
		await new Sidebar( session.mainWindow ).expectRunning( siteName );

		const siteUrl = await session.getSiteUrl( siteName );
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/options-general.php` ) );
		expect( await page.locator( '#WPLANG' ).inputValue() ).toBe( 'ja' );
	} );
} );
