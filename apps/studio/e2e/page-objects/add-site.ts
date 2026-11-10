import { type Page, expect } from '@playwright/test';
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
		return this.page.getByRole( 'dialog', { name: 'Add a WordPress' } );
	}

	get siteNameInput() {
		return this.dialog.getByRole( 'textbox', { name: 'Name' } );
	}

	get submitButton() {
		return this.dialog.getByTestId( 'create-site-submit' );
	}

	get fileInput() {
		return this.dialog.locator( 'input[type="file"][accept*=".json"]' );
	}

	// Opens Add site: it opens by itself with no sites, from the sidebar's "Add site" otherwise.
	async open() {
		const sidebar = new Sidebar( this.page );
		const addSiteButton = sidebar.addSiteButton;
		await expect( this.dialog.or( addSiteButton ).first() ).toBeVisible( { timeout: 60_000 } );
		if ( ! ( await this.dialog.isVisible() ) ) {
			await sidebar.ensureOpen();
			await addSiteButton.and( this.page.locator( ':not([inert] *)' ) ).click();
		}
		await expect( this.dialog ).toBeVisible();
	}

	// Creates a site and resolves with its name once the dialog has closed on it.
	async createSite( { siteName, pickFolder, blueprintPath }: CreateSiteOptions = {} ) {
		await this.open();
		// A Blueprint renames the site, so upload it before setting the name.
		if ( blueprintPath ) {
			await this.dialog.getByRole( 'tab', { name: 'Import', exact: true } ).click();
			await this.fileInput.setInputFiles( blueprintPath );
		} else {
			await this.dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		}
		await expect( this.siteNameInput ).toBeVisible();
		if ( siteName ) {
			await this.siteNameInput.fill( siteName );
		}
		if ( pickFolder ) {
			const folder = this.dialog.getByRole( 'textbox', { name: 'Folder' } );
			const previousPath = await folder.getAttribute( 'title' );
			await this.dialog.getByRole( 'button', { name: 'Change…', exact: true } ).click();
			await expect( folder ).not.toHaveAttribute( 'title', previousPath ?? '' );
		}

		let name = await this.siteNameInput.inputValue();
		if ( ! name ) {
			await expect( this.siteNameInput ).toHaveAttribute( 'placeholder', /\S+/ );
			name = ( await this.siteNameInput.getAttribute( 'placeholder' ) ) ?? '';
			await this.siteNameInput.fill( name );
		}
		expect( name ).toMatch( /\S+/ );

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
		await this.fileInput.setInputFiles( backupPath );
		await expect( this.siteNameInput ).toBeVisible();
		if ( siteName ) {
			await this.siteNameInput.fill( siteName );
		}
		const name = await this.siteNameInput.inputValue();
		await this.submitButton.click();
		return name;
	}
}
