import { type Page, expect } from '@playwright/test';
import ImportExportTab from './import-export-tab';
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

	get runningButton() {
		// Try new data-testid first, fall back to role-based selector for trunk compatibility
		return this.locator
			.getByTestId( 'site-status-running' )
			.or( this.locator.getByRole( 'button', { name: 'Running' } ) );
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
		return this.locator.getByLabel( 'Copy site url', { exact: false } );
	}

	getTabButton( tabName: 'Preview' | 'Settings' | 'Import / Export' ) {
		return this.locator.getByRole( 'tab', { name: tabName } );
	}

	async navigateToTab( tabName: 'Settings' ): Promise< SettingsTab >;
	async navigateToTab( tabName: 'Import / Export' ): Promise< ImportExportTab >;
	async navigateToTab(
		tabName: 'Preview' | 'Settings' | 'Import / Export'
	): Promise< SettingsTab | ImportExportTab > {
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
			case 'Import / Export': {
				const tab = new ImportExportTab( this.page );
				await expect( tab.locator ).toBeVisible();
				return tab;
			}
		}
	}
}
