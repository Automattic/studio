import { type ElectronApplication, type Page, expect } from '@playwright/test';

// App settings (`/settings`). Changes save as soon as they're made.
export default class AppSettings {
	constructor( private page: Page ) {}

	get closeButton() {
		return this.page.getByRole( 'button', { name: 'Close settings' } );
	}

	async open() {
		await this.page.getByRole( 'button', { name: 'App settings' } ).click();
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

	async close() {
		await this.closeButton.click();
		await expect( this.closeButton ).toBeHidden();
	}

	appearanceOption( name: 'System' | 'Light' | 'Dark' ) {
		return this.page.getByRole( 'group', { name: 'Appearance' } ).getByRole( 'button', { name } );
	}

	async selectColorScheme( name: 'System' | 'Light' | 'Dark' ) {
		await this.appearanceOption( name ).click();
		await expect( this.appearanceOption( name ) ).toHaveAttribute( 'aria-pressed', 'true' );
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
