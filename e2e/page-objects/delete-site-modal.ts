import { type Page } from '@playwright/test';

export default class DeleteSiteModal {
	constructor(
		private page: Page,
		private siteName: string
	) {}

	get locator() {
		// We use a long site name (leaky abstraction) which will be trimmed in the rendered dialog.
		// While this should not be a problem, in practice using the a portion of the name for the locator has proven effective where the full name failed.
		const visibileSiteName = this.siteName.split( '-' )[ 0 ];
		return this.page.getByRole( 'dialog', { name: `Delete ${ visibileSiteName }`, exact: false } );
	}

	get deleteFilesCheckbox() {
		return this.locator.getByRole( 'checkbox', { name: 'Delete site files' } );
	}

	get deleteSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Delete site' } );
	}
}
