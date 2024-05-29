import { type Page } from '@playwright/test';
import SiteForm from './site-form';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		return this.page.getByTestId( 'onboarding' );
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
