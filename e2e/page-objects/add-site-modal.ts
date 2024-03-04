import { type Page } from '@playwright/test';

export default class AddSiteModal {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByRole( 'dialog', { name: 'Add a site' } );
	}

	get siteNameInput() {
		return this.locator.getByLabel( 'Site name' );
	}

	get localPathInput() {
		return this.locator.getByLabel( 'Local path' );
	}

	get localPathButton() {
		return this.locator.getByTestId( 'select-path-button' );
	}

	get addSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Add site' } );
	}

	// This usually opens an OS folder dialog, except we can't interact with it in playwrite.
	// In tests the dialog returns the value of the E2E_OPEN_FOLDER_DIALOG environment variable.
	async clickLocalPathButtonAndSelectFromEnv() {
		await this.localPathButton.click();
	}
}
