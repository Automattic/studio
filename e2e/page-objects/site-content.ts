import { type Page, expect } from '@playwright/test';
import SettingsTab from './settings-tab';

export default class SiteContent {
	constructor(
		private page: Page,
		private siteName: string
	) {}

	get locator() {
		// The main site content area has no role, we need to select it by test id
		return this.page.getByTestId( 'site-content' );
	}

	get siteNameHeading() {
		return this.locator.getByRole( 'heading', { name: this.siteName } );
	}

	get frontendButton() {
		// Original: No longer works.
		//
		// return this.locator
		// 	.getByTestId( 'site-content-header' )
		// 	.getByRole( 'button', { name: 'localhost:', exact: false } );
		//
		// Obtained via --debug and the locator tool.
		// Less robust because uses label value which might change faster than the data-testid.
		return this.locator.getByLabel('Copy site url', { exact: false });
	}

	getTabButton( tabName: 'Preview' | 'Settings' ) {
		return this.locator.getByRole( 'tab', { name: tabName } );
	}

	async navigateToTab( tabName: 'Preview' | 'Settings' ) {
		const tabButton = this.getTabButton( tabName );
		await tabButton.click();

		switch ( tabName ) {
			case 'Preview':
				throw new Error( 'Not implemented' );
			case 'Settings': {
				const tab = new SettingsTab( this.page, this.siteName );
				await expect( tab.locator ).toBeVisible();
				return tab;
			}
		}
	}
}
