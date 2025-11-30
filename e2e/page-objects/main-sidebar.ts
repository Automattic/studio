import { type Page, expect } from '@playwright/test';
import AddSiteModal from './add-site-modal';

export default class MainSidebar {
	constructor( private page: Page ) {}

	get locator() {
		// The sidebar has no role, we need to select it by test id
		return this.page.getByTestId( 'main-sidebar' );
	}

	get addSiteButton() {
		return this.page.getByTestId( 'add-site-button' );
	}

	getSiteNavButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } );
	}

	async openAddSiteModal() {
		// If Studio has no sites, then the 'Add Site' button is not present, and the empty screen displays the content of the modal.
		await this.addSiteButton?.click();
		const dialog = new AddSiteModal( this.page );
		await expect( dialog.locator ).toBeVisible();
		return dialog;
	}
}
