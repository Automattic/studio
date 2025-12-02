import { type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import AddSiteModal from './add-site-modal';
import WhatsNewModal from './whats-new-modal';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		return this.page.getByTestId( 'onboarding' );
	}

	get heading() {
		return this.locator.getByRole( 'heading', {
			name: /Connect to your WordPress.com account|Connect your WordPress.com account/,
		} );
	}

	async completeOnboarding( options?: { customSiteName?: string; customFolderName?: string } ) {
		const { customSiteName, customFolderName } = options ?? {};

		await expect( this.heading ).toBeVisible();
		await this.locator.getByRole( 'button', { name: 'Skip →' } ).click();
		const modal = new AddSiteModal( this.page );
		await modal.open();
		await modal.createSiteButton.click();

		if ( customSiteName ) {
			await modal.siteNameInput.fill( customSiteName );
		}
		await expect( modal.siteNameInput ).toHaveValue( /\S+/, { timeout: 5000 } );
		const siteName = await modal.siteNameInput.inputValue();

		if ( customFolderName ) {
			await modal.selectLocalPathForTesting( customFolderName );
		}
		const localPath = await modal.localPathInput.inputValue();

		await modal.continueButton.click();

		return {
			siteName,
			localPath,
		};
	}

	async closeWhatsNew() {
		const whatsNewModal = new WhatsNewModal( this.page );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.closeButton.click();
		}
	}
}
