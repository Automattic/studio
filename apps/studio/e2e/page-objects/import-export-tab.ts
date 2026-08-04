import { type Page } from '@playwright/test';

export default class ImportExportTab {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.locator( '[role="tabpanel"][id$="-import-export-view"]' );
	}

	get importDropZone() {
		return this.locator.getByText( /Drag a file here, or click to select a file/i );
	}

	get importFileInput() {
		return this.page.getByTestId( 'backup-file' );
	}

	get importProgressBar() {
		return this.locator.getByRole( 'progressbar' );
	}

	get importCompleteBanner() {
		return this.locator.getByText( 'Import complete!' );
	}

	get importStatusMessage() {
		return this.locator.getByText( /Import/i );
	}

	get exportFullSiteButton() {
		return this.locator.getByRole( 'button', { name: /Export entire site/i } );
	}

	get exportDatabaseButton() {
		return this.locator.getByRole( 'button', { name: /Export database/i } );
	}

	async uploadFile( filePath: string ) {
		await this.importFileInput.setInputFiles( filePath );
	}

	async clickImportDropZone() {
		await this.importDropZone.click();
	}
}
