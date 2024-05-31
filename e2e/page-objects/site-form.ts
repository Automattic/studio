import { type Page } from '@playwright/test';

export default class SiteForm {
	private page: Page;

	constructor( page: Page ) {
		this.page = page;
	}

	get siteNameInput() {
		return this.page.getByLabel( 'Site name' );
	}

	get localPathInput() {
		return this.page.getByLabel( 'Local path' );
	}

	private get localPathButton() {
		return this.page.getByTestId( 'select-path-button' );
	}

	// This usually opens an OS folder dialog, except we can't interact with it in Playwright.
	// In tests the dialog returns the value of the E2E_OPEN_FOLDER_DIALOG environment variable.
	async clickLocalPathButtonAndSelectFromEnv() {
		await this.localPathButton.click();
	}
}
