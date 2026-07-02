import { expect, type Page } from '@playwright/test';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';

export default class SiteForm {
	private page: Page;

	constructor( page: Page ) {
		this.page = page;
	}

	get siteNameInput() {
		// Try new data-testid first, fall back to label-based selector for trunk compatibility
		return this.page
			.getByTestId( 'site-name-input' )
			.or( this.page.locator( 'label:has-text("Site name") input' ) );
	}

	get localPathInput() {
		return this.page.getByTestId( 'local-path-input' );
	}

	get phpRuntimeSelect() {
		return this.page.locator( '#php-runtime-select' );
	}

	private get localPathButton() {
		return this.page.getByTestId( 'select-path-button' );
	}

	private get advancedSettingsToggle() {
		return this.page.getByTestId( 'advanced-settings-button' );
	}

	// The runtime/file-access controls live inside the collapsed "Advanced
	// settings" section. Expanding is idempotent: only toggle when the runtime
	// dropdown isn't already revealed.
	async openAdvancedSettings() {
		if ( ! ( await this.phpRuntimeSelect.isVisible().catch( () => false ) ) ) {
			await this.advancedSettingsToggle.click();
			await expect( this.phpRuntimeSelect ).toBeVisible();
		}
	}

	async selectRuntime( runtime: SiteRuntime ) {
		await this.openAdvancedSettings();
		await this.phpRuntimeSelect.selectOption( runtime );
	}

	// This usually opens an OS folder dialog, except we can't interact with it in Playwright.
	// In tests the dialog returns the value of the E2E_OPEN_FOLDER_DIALOG environment variable.
	async clickLocalPathButtonAndSelectFromEnv( partialExpectedPath: string ) {
		await this.advancedSettingsToggle.click();
		await this.localPathButton.click();
		await expect( this.localPathInput ).toHaveValue( new RegExp( partialExpectedPath, 'i' ), {
			timeout: 5000,
		} );
	}
}
