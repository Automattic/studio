import { type Page, expect } from '@playwright/test';
import Sidebar from './sidebar';

// A site's settings page: the "Settings" and "Debugging" tabs.
export default class SiteSettings {
	constructor( private page: Page ) {}

	async open( siteName: string ) {
		await new Sidebar( this.page )
			.getSiteRow( siteName )
			.getByRole( 'button', { name: 'Site settings' } )
			.click();
		await expect( this.page.getByRole( 'tab', { name: 'Settings' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	}

	get siteNameInput() {
		return this.page.getByRole( 'textbox', { name: 'Site name' } );
	}

	get phpVersionSelect() {
		return this.page.getByRole( 'combobox', { name: 'PHP version' } );
	}

	async saveSettings() {
		await this.page.getByRole( 'button', { name: 'Save settings' } ).click();
		await expect( this.page.getByText( 'Settings saved' ) ).toBeVisible( { timeout: 120_000 } );
	}
}
