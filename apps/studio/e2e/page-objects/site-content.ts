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

	getTabButton( tab: 'preview' | 'settings' | 'import-export' ) {
		return this.locator.locator( `[role="tab"][id$="-${ tab }"]` );
	}

	async navigateToTab( tab: 'settings' ): Promise< SettingsTab >;
	async navigateToTab( tab: 'import-export' ): Promise< ImportExportTab >;
	async navigateToTab(
		tab: 'preview' | 'settings' | 'import-export'
	): Promise< SettingsTab | ImportExportTab > {
		const tabButton = this.getTabButton( tab );
		await tabButton.click();

		switch ( tab ) {
			case 'preview':
				throw new Error( 'Not implemented' );
			case 'settings': {
				const settingsTab = new SettingsTab( this.page, this.siteName );
				await expect( settingsTab.locator ).toBeVisible();
				return settingsTab;
			}
			case 'import-export': {
				const importExportTab = new ImportExportTab( this.page );
				await expect( importExportTab.locator ).toBeVisible();
				return importExportTab;
			}
		}
	}
}
