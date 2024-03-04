import { type Page } from '@playwright/test';

export default class DeleteSiteModal {
	constructor(
		private page: Page,
		private siteName: string
	) {}

	get locator() {
		return this.page.getByRole( 'dialog', { name: `Delete ${ this.siteName }` } );
	}

	get deleteFilesCheckbox() {
		return this.locator.getByRole( 'checkbox', { name: 'Delete site files' } );
	}

	get deleteSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Delete site' } );
	}
}
