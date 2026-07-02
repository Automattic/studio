import { type Page, type ElectronApplication } from '@playwright/test';

export default class SettingsTab {
	constructor(
		private page: Page,
		private siteName: string
	) {}

	get locator() {
		return this.page.locator( '[role="tabpanel"][id$="-settings-view"]' );
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

	get duplicateButton() {
		// Rendered at the document root like the delete menu item, so search from
		// the page rather than the settings tabpanel.
		return this.page.getByRole( 'menuitem', { name: 'Duplicate site' } );
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

	async openDuplicateSite() {
		await this.optionsMenu.click();
		await this.duplicateButton.click();
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

	/**
	 * Read-only PHP-version row on the Settings tab body itself (not the
	 * Edit dialog). Bound to Redux state; updates as soon as the
	 * SITE_EVENTS.UPDATED round-trip from the CLI _events subprocess
	 * lands. Use this to gate the next dialog open after a save — the
	 * dialog's own dropdown is seeded from `useState` at mount time and
	 * does not resync on later prop changes.
	 */
	get phpVersionDisplay() {
		return this.locator.getByRole( 'row', { name: /PHP version/i } );
	}

	// Read-only "PHP runtime" row on the Settings tab body. Reports "Native" or
	// "Sandbox" for the site's configured runtime.
	get phpRuntimeDisplay() {
		return this.locator.getByRole( 'row', { name: /PHP runtime/i } );
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
