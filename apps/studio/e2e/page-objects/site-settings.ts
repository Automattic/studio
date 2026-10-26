import { type Page, expect } from '@playwright/test';
import Sidebar from './sidebar';

// A site's settings in the settings dialog.
export default class SiteSettings {
	constructor( private page: Page ) {}

	async open( siteName: string ) {
		await new Sidebar( this.page ).openContextMenuItem( siteName, 'Settings' );
		await expect( this.siteNameInput ).toBeVisible();
	}

	async showSection( name: 'Settings' | 'PHP' | 'Debug' | 'Instructions' ) {
		await this.page
			.getByRole( 'tablist', { name: 'Settings sections' } )
			.getByRole( 'tab', { name } )
			.click();
	}

	async close() {
		await this.page.getByRole( 'button', { name: 'Close settings' } ).click();
		await expect( this.page.getByRole( 'button', { name: 'Close settings' } ) ).toBeHidden();
	}

	get siteNameInput() {
		return this.page.getByRole( 'textbox', { name: 'Site name' } );
	}

	get phpVersionSelect() {
		return this.page.getByRole( 'combobox', { name: 'PHP version' } );
	}

	async selectPhpVersion( version: string ) {
		await this.phpVersionSelect.click();
		await this.page.getByRole( 'option', { name: version, exact: true } ).click();
	}

	async saveSettings() {
		await this.page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect( this.page.getByText( 'Settings saved' ) ).toBeVisible( { timeout: 120_000 } );
	}
}
