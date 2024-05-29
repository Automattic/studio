import { type Page } from '@playwright/test';
import SiteForm from './site-form';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		// This fails, not sure why...
		// return this.page.getByTestId( 'onboarding' );
		//
		// Accessing the Page directly works even though it's confusing because Page is not a Locator
		return this.page;
	}

	private get siteForm() {
		return new SiteForm( this.page );
	}

	get heading() {
		return this.locator.getByRole( 'heading', { name: 'Add your first site' } );
	}

	get siteNameInput() {
		return this.siteForm.siteNameInput;
	}

	get localPathInput() {
		return this.siteForm.localPathInput;
	}

	get continueButton() {
		return this.locator.getByRole( 'button', { name: 'Add site' } );
	}

	async selectLocalPathForTesting() {
		await this.siteForm.clickLocalPathButtonAndSelectFromEnv();
	}
}
