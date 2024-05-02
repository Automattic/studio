import { type Page } from '@playwright/test';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		// This fails, not sure why...
		// return this.page.getByTestId( 'onboarding' );
		//
		// Accessing the Page directly works even though it's confusing because Page is not a Locator
		return this.page;
	}

	get heading() {
		return this.locator.getByRole('heading', { name: 'Add your first site' });
	}

	get siteNameInput() {
		return this.locator.getByLabel( 'Site name' );
	}

	get sitePathInput() {
		return this.locator.getByLabel( 'Local path' );
	}

	get continueButton() {
		return this.locator.getByRole('button', { name: 'Continue' });
	}

	private get localPathButton() {
		return this.locator.getByTestId( 'select-path-button' );
	}

	// This usually opens an OS folder dialog, except we can't interact with it in playwrite.
	// In tests the dialog returns the value of the E2E_OPEN_FOLDER_DIALOG environment variable.
	async clickLocalPathButtonAndSelectFromEnv() {
		await this.localPathButton.click();
	}
}
