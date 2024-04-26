import { type Page } from '@playwright/test';

export default class Onboarding {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByTestId( 'onboarding' );
	}

	get siteNameInput() {
		return this.locator.getByLabel( 'Site name' );
	}

  // See add-site-modal for more bit we'll likely need here
}
