import { expect, type Page } from '@playwright/test';

export default class SiteForm {
	private page: Page;

	constructor( page: Page ) {
		this.page = page;
	}

	get siteNameInput() {
		// Try new data-testid first, fall back to label-based selector for trunk compatibility
		return this.page
			.getByTestId( 'site-name-input' )
			.or( this.page.locator( 'label:has-text("Site name") input' ) );
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
	async clickLocalPathButtonAndSelectFromEnv( partialExpectedPath: string ) {
		await this.advancedSettingsToggle.click();
		await this.localPathButton.click();
		await expect( this.localPathInput ).toHaveValue( new RegExp( partialExpectedPath, 'i' ), {
			timeout: 5000,
		} );
	}
}
