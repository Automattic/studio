import { type Page, expect } from '@playwright/test';
import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import Sidebar from './sidebar';

export type CreateSiteOptions = {
	siteName?: string;
	// Pick the folder returned by the mocked folder dialog (E2E_OPEN_FOLDER_DIALOG).
	pickFolder?: boolean;
	blueprintPath?: string;
};

// The Add site dialog and the create/import forms it leads to.
export default class AddSite {
	constructor( private page: Page ) {}

	get dialog() {
		return this.page.getByRole( 'dialog', { name: 'Add site' } );
	}

	get siteNameInput() {
		return this.dialog.getByRole( 'textbox', { name: 'Site name' } );
	}

	get submitButton() {
		return this.dialog.getByTestId( 'create-site-submit' );
	}

	get backupFileInput() {
		return this.dialog.locator(
			`input[type="file"][accept="${ ACCEPTED_ADD_SITE_FILE_TYPES.join( ',' ) }"]`
		);
	}

	get blueprintFileInput() {
		return this.dialog.locator(
			'input[type="file"][accept="application/json,.json,application/zip,.zip"]'
		);
	}

	// Opens Add site: it opens by itself with no sites, from the sidebar's "Add site" otherwise.
	async open() {
		const addSiteButton = new Sidebar( this.page ).addSiteButton;
		await expect( this.dialog.or( addSiteButton ).first() ).toBeVisible( { timeout: 60_000 } );
		if ( ! ( await this.dialog.isVisible() ) ) {
			await addSiteButton.click();
		}
		await expect( this.dialog ).toBeVisible();
	}

	async openAdvancedSettings() {
		const toggle = this.dialog.getByRole( 'button', { name: 'Advanced settings' } );
		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await toggle.click();
		}
	}

	// Creates a site and resolves with its name once the dialog has closed on it.
	async createSite( { siteName, pickFolder, blueprintPath }: CreateSiteOptions = {} ) {
		await this.open();
		await this.dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		await expect( this.siteNameInput ).toBeVisible();

		// A Blueprint renames the site, so upload it before setting the name.
		if ( blueprintPath ) {
			await this.blueprintFileInput.setInputFiles( blueprintPath );
			await expect( this.submitButton ).toHaveText( 'Create site from Blueprint' );
		}
		if ( siteName ) {
			await this.siteNameInput.fill( siteName );
		}
		await expect( this.siteNameInput ).toHaveValue( /\S+/ );
		const name = await this.siteNameInput.inputValue();

		if ( pickFolder ) {
			await this.openAdvancedSettings();
			await this.dialog
				.getByRole( 'button', { name: /select a different folder|Select a folder/ } )
				.click();
			await expect(
				this.dialog.getByRole( 'button', { name: /select a different folder$/ } )
			).toBeVisible();
		}

		await this.submitButton.click();
		// The dialog closes on the navigation to the new site, which would also close
		// anything a test opens meanwhile.
		await expect( this.dialog ).toBeHidden( { timeout: 120_000 } );
		return name;
	}

	// Imports a backup as a new site and resolves with its name once the import is submitted.
	async importSite( backupPath: string, siteName?: string ) {
		await this.open();
		await this.dialog.getByRole( 'tab', { name: 'Import', exact: true } ).click();
		await this.backupFileInput.setInputFiles( backupPath );
		await expect( this.siteNameInput ).toBeVisible();
		if ( siteName ) {
			await this.siteNameInput.fill( siteName );
		}
		const name = await this.siteNameInput.inputValue();
		await this.submitButton.click();
		return name;
	}
}
