import { type Page, expect } from '@playwright/test';
import Sidebar from './sidebar';

// A site's settings in the settings dialog: the "Settings", "PHP" and "Debug" sections.
export default class SiteSettings {
	constructor( private page: Page ) {}

	async open( siteName: string ) {
		await new Sidebar( this.page ).openContextMenuItem( siteName, 'Site settings' );
		await expect( this.siteNameInput ).toBeVisible();
	}

	async showSection( name: 'Settings' | 'PHP' | 'Debug' ) {
		await this.page
			.getByRole( 'navigation', { name: 'Settings sections' } )
			.getByRole( 'button', { name } )
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

	async saveSettings() {
		await this.page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect( this.page.getByText( 'Settings saved' ) ).toBeVisible( { timeout: 120_000 } );
	}
}
