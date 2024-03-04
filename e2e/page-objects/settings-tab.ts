import { type Page, type ElectronApplication, expect } from '@playwright/test';
import DeleteSiteModal from './delete-site-modal';

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
		return this.locator.getByRole( 'button', { name: 'Delete site' } );
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
		await this.deleteButton.click();
		const modal = new DeleteSiteModal( this.page, this.siteName );
		await expect( modal.locator ).toBeVisible();
		return modal;
	}
}
