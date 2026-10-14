import { type Page, expect } from '@playwright/test';
import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import Sidebar from './sidebar';

export type CreateSiteOptions = {
	siteName?: string;
	// Pick the folder returned by the mocked folder dialog (E2E_OPEN_FOLDER_DIALOG).
	pickFolder?: boolean;
	blueprintPath?: string;
};

// The "Add a site" screen and the create/import forms it leads to.
export default class AddSite {
	constructor( private page: Page ) {}

	get heading() {
		return this.page.getByRole( 'heading', { name: 'Add a site', level: 1 } );
	}

	get siteNameInput() {
		return this.page.getByRole( 'textbox', { name: 'Site name' } );
	}

	get submitButton() {
		return this.page.getByTestId( 'create-site-submit' );
	}

	get backupFileInput() {
		return this.page.locator(
			`input[type="file"][accept="${ ACCEPTED_ADD_SITE_FILE_TYPES.join( ',' ) }"]`
		);
	}

	get blueprintFileInput() {
		return this.page.locator(
			'input[type="file"][accept="application/json,.json,application/zip,.zip"]'
		);
	}

	// Opens "Add a site": the first screen with no sites, the sidebar's "Add site" otherwise.
	async open() {
		const addSiteButton = new Sidebar( this.page ).addSiteButton;
		await expect( this.heading.or( addSiteButton ) ).toBeVisible( { timeout: 60_000 } );
		if ( ! ( await this.heading.isVisible() ) ) {
			await addSiteButton.click();
		}
		await expect( this.heading ).toBeVisible();
	}

	async openAdvancedSettings() {
		const toggle = this.page.getByRole( 'button', { name: 'Advanced settings' } );
		if ( ( await toggle.getAttribute( 'aria-expanded' ) ) !== 'true' ) {
			await toggle.click();
		}
	}

	// Creates a site and resolves with its name once the form has been submitted.
	async createSite( { siteName, pickFolder, blueprintPath }: CreateSiteOptions = {} ) {
		await this.open();
		await this.page.getByRole( 'link', { name: /Create a new site/ } ).click();
		await expect(
			this.page.getByRole( 'heading', { name: 'Create a new site', level: 1 } )
		).toBeVisible();

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
			await this.page
				.getByRole( 'button', { name: /select a different folder|Select a folder/ } )
				.click();
			await expect(
				this.page.getByRole( 'button', { name: /select a different folder$/ } )
			).toBeVisible();
		}

		await this.submitButton.click();
		return name;
	}

	// Imports a backup as a new site and resolves with its name once the import is submitted.
	async importSite( backupPath: string, siteName?: string ) {
		await this.open();
		await this.backupFileInput.setInputFiles( backupPath );
		await expect(
			this.page.getByRole( 'heading', { name: 'Set up your imported site', level: 1 } )
		).toBeVisible();
		if ( siteName ) {
			await this.siteNameInput.fill( siteName );
		}
		const name = await this.siteNameInput.inputValue();
		await this.submitButton.click();
		return name;
	}
}
