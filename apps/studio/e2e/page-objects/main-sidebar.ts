import { type Page, expect } from '@playwright/test';
import AddSiteModal from './add-site-modal';

export default class MainSidebar {
	constructor( private page: Page ) {}

	get locator() {
		// The sidebar has no role, we need to select it by test id
		return this.page.getByTestId( 'main-sidebar' );
	}

	get addSiteButton() {
		return this.locator.getByTestId( 'add-site-button' );
	}

	getSiteNavButton( siteName: string ) {
		return this.locator.getByRole( 'button', { name: siteName, exact: true } );
	}

	getStopAllButton() {
		// The button is labeled "Stop" with one running site and "Stop all" with multiple.
		return this.locator.getByRole( 'button', { name: /^Stop( all)?$/ } );
	}

	async openAddSiteModal() {
		const isButtonVisible = await this.addSiteButton.isVisible().catch( () => false );

		if ( ! isButtonVisible ) {
			throw new Error( 'Add Site button not found on the main sidebar' );
		}

		await this.addSiteButton.click();
		const dialog = new AddSiteModal( this.page );
		await expect( dialog.locator ).toBeVisible();
		return dialog;
	}
}
