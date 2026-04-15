import { type Page } from '@playwright/test';
import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import SiteForm from './site-form';

export default class AddSiteModal {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByRole( 'dialog' );
	}

	get createSiteButton() {
		return this.page.getByTestId( 'create-site-option-button' );
	}

	get blueprintButton() {
		return this.page.locator( 'button:has-text("Start from a Blueprint")' ).first();
	}

	get importButton() {
		return this.page.locator( 'button:has-text("Import from a backup")' ).first();
	}

	get continueButton() {
		return this.page.getByTestId( 'stepper-action-button' );
	}

	get fileInput() {
		return this.page.locator( 'input[type="file"][accept=".json,application/json"]' );
	}

	get backupFileInput() {
		const fileTypes = ACCEPTED_IMPORT_FILE_TYPES.join( ',' );
		return this.page.locator( `input[type="file"][accept="${ fileTypes }"]` );
	}

	private get siteForm() {
		return new SiteForm( this.page );
	}

	get siteNameInput() {
		return this.siteForm.siteNameInput;
	}

	get localPathInput() {
		return this.siteForm.localPathInput;
	}

	get addSiteButton() {
		return this.page.getByTestId( 'stepper-action-button' );
	}

	async selectLocalPathForTesting( partialExpectedPath: string ) {
		await this.siteForm.clickLocalPathButtonAndSelectFromEnv( partialExpectedPath );
	}

	async selectBlueprintFile( filePath: string ) {
		await this.fileInput.setInputFiles( filePath );
	}

	async selectBackupFile( filePath: string ) {
		await this.backupFileInput.setInputFiles( filePath );
	}
}
