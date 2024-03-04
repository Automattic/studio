import { type Page, expect } from '@playwright/test';
import AddSiteModal from './add-site-modal';

export default class MainSidebar {
	constructor( private page: Page ) {}

	get locator() {
		// The sidebar has no role, we need to select it by test id
		return this.page.getByTestId( 'main-sidebar' );
	}

	get addSiteButton() {
		return this.locator.getByRole( 'button', { name: 'Add site' } );
	}

	getSiteNavButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } );
	}

	async openAddSiteModal() {
		await this.addSiteButton.click();
		const dialog = new AddSiteModal( this.page );
		await expect( dialog.locator ).toBeVisible();
		return dialog;
	}
}
