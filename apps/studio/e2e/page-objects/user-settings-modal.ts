import { type Page, expect } from '@playwright/test';

export default class UserSettingsModal {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByRole( 'dialog', { name: 'Settings' } );
	}

	get preferencesTab() {
		return this.locator.getByRole( 'tab', { name: 'Preferences' } );
	}

	get accountTab() {
		return this.locator.getByRole( 'tab', { name: 'Account' } );
	}

	get usageTab() {
		return this.locator.getByRole( 'tab', { name: 'Usage' } );
	}

	get languageSelect() {
		return this.page.getByTestId( 'language-select' );
	}

	get saveButton() {
		return this.page.getByTestId( 'preferences-save-button' );
	}

	get cancelButton() {
		return this.page.getByTestId( 'preferences-cancel-button' );
	}

	get closeButton() {
		return this.locator.getByRole( 'button', { name: 'Close' } );
	}

	get appearanceRadioGroup() {
		return this.locator.getByRole( 'radiogroup', { name: 'Appearance' } );
	}

	getAppearanceOption( name: string ) {
		return this.appearanceRadioGroup.getByRole( 'radio', { name } );
	}

	async selectColorScheme( scheme: 'System' | 'Light' | 'Dark' ) {
		const option = this.getAppearanceOption( scheme );
		await option.click();
		await expect( option ).toHaveAttribute( 'aria-checked', 'true' );
	}

	async selectLanguage( language: string ) {
		await this.languageSelect.selectOption( { label: language } );
	}

	async save() {
		await this.saveButton.click();
		await expect( this.locator ).not.toBeVisible();
	}

	async cancel() {
		await this.cancelButton.click();
		await expect( this.locator ).not.toBeVisible();
	}

	async close() {
		await this.closeButton.click();
		await expect( this.locator ).not.toBeVisible();
	}
}
