import { type ElectronApplication, type Page, expect } from '@playwright/test';

// Studio settings in the settings dialog. Changes save as soon as they're made.
export default class AppSettings {
	constructor( private page: Page ) {}

	get closeButton() {
		return this.page.getByRole( 'button', { name: 'Close settings' } );
	}

	async open() {
		await this.page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		await expect( this.closeButton ).toBeVisible();
	}

	// Through the app menu's Settings item, which works whatever the UI language.
	async openFromAppMenu( electronApp: ElectronApplication ) {
		await electronApp.evaluate( ( { BrowserWindow } ) => {
			const window = BrowserWindow.getAllWindows().find( ( candidate ) => candidate.isVisible() );
			window?.webContents.send( 'user-settings', { tabName: 'general' } );
		} );
		await expect( this.page.getByRole( 'combobox' ).first() ).toBeVisible();
	}

	// The language change reloads the window, which reopens settings: wait for it first.
	async closeWithEscape() {
		await expect( this.page.getByRole( 'dialog' ) ).toBeVisible();
		await this.page.keyboard.press( 'Escape' );
		await expect( this.page.getByRole( 'dialog' ) ).toBeHidden();
	}

	async close() {
		await this.closeButton.click();
		await expect( this.closeButton ).toBeHidden();
	}

	async showSection( name: string ) {
		await this.page
			.getByRole( 'navigation', { name: 'Settings sections' } )
			.getByRole( 'button', { name } )
			.click();
	}

	get themeSelect() {
		return this.page.getByRole( 'combobox', { name: 'Theme' } );
	}

	async selectColorScheme( name: 'System' | 'Light' | 'Dark' ) {
		await this.themeSelect.click();
		await this.page.getByRole( 'option', { name } ).click();
		await expect( this.themeSelect ).toHaveText( name );
	}

	/**
	 * Switches language from `from` to `to` (native names, e.g. "Français"), which reloads the
	 * window. Found by its current value, not its label, which is translated too.
	 */
	async selectLanguage( from: string, to: string, lang: string ) {
		await this.page.getByRole( 'combobox' ).filter( { hasText: from } ).click();
		await this.page.getByRole( 'option', { name: to } ).click();
		await expect( this.page.locator( 'html' ) ).toHaveAttribute(
			'lang',
			new RegExp( `^${ lang }` ),
			{
				timeout: 30_000,
			}
		);
	}
}
