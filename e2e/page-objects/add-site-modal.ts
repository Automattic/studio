import { type Page } from '@playwright/test';
import SiteForm from './site-form';

export default class AddSiteModal {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByRole( 'dialog', { name: 'Add a site' } );
	}

	private get siteForm() {
		return new SiteForm( this.page );
	}

	get siteNameInput() {
		return this.siteForm.siteNameInput;
	}

	get localPathInput() {
		return this.siteForm.localPathInput;
	}

	get addSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Add site' } );
	}

	async selectLocalPathForTesting() {
		await this.siteForm.clickLocalPathButtonAndSelectFromEnv();
	}
}
