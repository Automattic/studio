import { type Page } from '@playwright/test';

export default class WhatsNewModal {
	constructor( private page: Page ) {}

	get locator() {
		return this.page.getByRole( 'dialog', { name: "What's New in Studio" } );
	}

	get closeButton() {
		return this.locator.getByRole( 'button', { name: 'Close' } );
	}
}
