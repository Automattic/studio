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
		return this.page.getByTestId( 'local-path-input' );
	}

	private get localPathButton() {
		return this.page.getByTestId( 'select-path-button' );
	}

	private get advancedSettingsToggle() {
		return this.page.getByTestId( 'advanced-settings-button' );
	}

	// This usually opens an OS folder dialog, except we can't interact with it in Playwright.
	// In tests the dialog returns the value of the E2E_OPEN_FOLDER_DIALOG environment variable.
	async clickLocalPathButtonAndSelectFromEnv() {
		await this.advancedSettingsToggle.click();
		await this.localPathButton.click();
		// Wait an arbitrary amount of time for the IPC handler to resolve
		await this.page.waitForTimeout( 1000 );
	}
}
