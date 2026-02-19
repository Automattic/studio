import { type Page, type ElectronApplication } from '@playwright/test';

export default class SettingsTab {
	constructor(
		private page: Page,
		private siteName: string
	) {}

	get locator() {
		return this.page.getByRole( 'tabpanel', { name: 'Settings' } );
	}

	get copyWPAdminButton() {
		return this.locator.getByRole( 'button', {
			name: 'Copy wp-admin url to clipboard',
		} );
	}

	get copySiteUrlButton() {
		return this.locator.getByRole( 'button', {
			name: 'Copy site url to clipboard',
		} );
	}

	get deleteButton() {
		// The delete button is a menu item rendered at the root level of the document,
		// so we need to search for it using page.locator instead of locator.locator.
		return this.page.getByRole( 'menuitem', { name: 'Delete site' } );
	}

	get optionsMenu() {
		return this.locator.getByRole( 'button', { name: 'More options' } );
	}

	async copyWPAdminUrlToClipboard( electronApp: ElectronApplication ) {
		await this.copyWPAdminButton.click();
		return await electronApp.evaluate( ( app ) => app.clipboard.readText() );
	}

	async copySiteUrlToClipboard( electronApp: ElectronApplication ) {
		await this.copySiteUrlButton.click();
		return await electronApp.evaluate( ( app ) => app.clipboard.readText() );
	}

	async openDeleteSiteModal() {
		await this.optionsMenu.click();
		await this.deleteButton.click();
	}

	get editSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Edit site' } );
	}

	get editSiteDialog() {
		return this.page.getByRole( 'dialog' );
	}

	get siteNameInput() {
		return this.editSiteDialog.getByLabel( 'Site name' );
	}

	get phpVersionSelect() {
		return this.editSiteDialog.getByLabel( 'PHP version' );
	}

	get saveButton() {
		return this.editSiteDialog.getByRole( 'button', { name: 'Save' } );
	}

	async changePhpVersion( version: string ) {
		await this.editSiteButton.click();
		await this.editSiteDialog.waitFor( { state: 'visible' } );
		await this.phpVersionSelect.selectOption( version );
		await this.saveButton.click();
		await this.editSiteDialog.waitFor( { state: 'hidden' } );
	}
}
