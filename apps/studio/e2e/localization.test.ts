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
		await settings.closeWithEscape();
	};

	test.beforeAll( async () => {
		await launchWithSite( session );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
		if ( current !== 'English' ) {
			await changeLanguage( 'English', 'en' );
		}
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'applies a language, right-to-left included, and keeps it across a restart', async () => {
		await changeLanguage( 'العربية', 'ar' );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute( 'dir', 'rtl' );
		await expect( session.mainWindow.getByRole( 'button', { name: 'إضافة موقع' } ) ).toBeVisible();

		await session.restart();
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute( 'dir', 'rtl' );
		await expect( session.mainWindow.getByRole( 'button', { name: 'إضافة موقع' } ) ).toBeVisible();

		await changeLanguage( 'English', 'en' );
		await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute( 'dir', 'ltr' );
		await expect( session.mainWindow.getByRole( 'button', { name: 'Add site' } ) ).toBeVisible();
	} );

	test( 'created site language matches Studio language', async ( { page } ) => {
		const siteName = 'Localized-Site-Test';
		await changeLanguage( '日本語', 'ja' );

		await new Sidebar( session.mainWindow ).ensureOpen();
		await session.mainWindow
			.getByRole( 'button', { name: 'サイトを追加', exact: true } )
			.and( session.mainWindow.locator( ':not([inert] *)' ) )
			.click();
		const dialog = session.mainWindow.getByRole( 'dialog' );
		await dialog.locator( '[data-start-blank]' ).click();
		await dialog.getByRole( 'textbox' ).first().fill( siteName );
		await dialog.getByTestId( 'create-site-submit' ).click();
		await new Sidebar( session.mainWindow ).expectRunning( siteName );

		const siteUrl = await session.getSiteUrl( siteName );
		await page.goto( getUrlWithAutoLogin( `${ siteUrl }/wp-admin/options-general.php` ) );
		expect( await page.locator( '#WPLANG' ).inputValue() ).toBe( 'ja' );
	} );
} );
