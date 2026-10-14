import { type Page, expect } from '@playwright/test';
import Sidebar from './sidebar';

// A site's overview: the "Overview" and "Settings" tabs.
export default class SiteOverview {
	constructor( private page: Page ) {}

	tab( name: 'Overview' | 'Settings' | 'Debugging' ) {
		return this.page.getByRole( 'tab', { name } );
	}

	async open( siteName: string, tab: 'Overview' | 'Settings' = 'Overview' ) {
		await new Sidebar( this.page ).openSite( siteName );
		await this.tab( tab ).click();
		await expect( this.tab( tab ) ).toHaveAttribute( 'aria-selected', 'true' );
	}

	get siteNameInput() {
		return this.page.getByRole( 'textbox', { name: 'Site name' } );
	}

	get phpVersionSelect() {
		return this.page.getByRole( 'combobox', { name: 'PHP version' } );
	}

	async saveSettings() {
		await this.page.getByRole( 'button', { name: 'Save settings' } ).click();
		await expect( this.page.getByText( 'Settings saved' ) ).toBeVisible( { timeout: 120_000 } );
	}

	manageButton(
		name: 'Duplicate' | 'Delete' | 'Import' | 'Export entire site' | 'Export database'
	) {
		return this.page.getByRole( 'button', { name, exact: true } );
	}

	get importFileInput() {
		return this.page.getByTestId( 'import-backup-file' );
	}

	// Imports a backup into this site, confirming the overwrite.
	async importBackup( backupPath: string ) {
		await this.importFileInput.setInputFiles( backupPath );
		const dialog = this.page.getByRole( 'alertdialog' );
		await expect( dialog ).toContainText( 'Importing a backup will replace' );
		await dialog.getByRole( 'button', { name: 'Import' } ).click();
	}
}
