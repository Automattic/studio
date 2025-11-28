import { type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import MainSidebar from './main-sidebar';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		return this.page.getByTestId( 'onboarding' );
	}

	get heading() {
		return this.locator.getByRole( 'heading', { name: 'Connect to your WordPress.com account' } );
	}

	get skipButton() {
		return this.locator.getByRole( 'button', { name: 'Skip →' } );
	}

	async completeOnboarding() {
		await expect( this.heading ).toBeVisible();
		await this.skipButton.click();
		const sidebar = new MainSidebar( this.page );
		const modal = await sidebar.openAddSiteModal();
		await modal.createSiteButton.click();
		await modal.continueButton.click();
	}
}
