import { type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';
import AddSiteModal from './add-site-modal';
import WhatsNewModal from './whats-new-modal';

export default class Onboarding {
	constructor( private page: Page ) {}

	private get locator() {
		return this.page.getByTestId( 'onboarding' );
	}

	get heading() {
		return this.locator.getByTestId( 'onboarding-welcome-title' );
	}

	async completeOnboarding( options?: {
		customSiteName?: string;
		customFolderName?: string;
		runtime?: SiteRuntime;
	} ) {
		const { customSiteName, customFolderName, runtime } = options ?? {};

		await expect( this.heading ).toBeVisible();
		await this.locator.getByRole( 'button', { name: 'Skip' } ).click();
		const modal = new AddSiteModal( this.page );
		await modal.createSiteButton.click();

		const emptySiteButton = this.page.getByRole( 'button', { name: /Empty site/ } );
		if ( await emptySiteButton.isVisible( { timeout: 2000 } ).catch( () => false ) ) {
			await emptySiteButton.click();
			await modal.continueButton.click();
		}

		if ( customSiteName ) {
			await modal.siteNameInput.fill( customSiteName );
		}
		await expect( modal.siteNameInput ).toHaveValue( /\S+/, { timeout: 5000 } );
		const siteName = await modal.siteNameInput.inputValue();

		if ( customFolderName ) {
			await modal.selectLocalPathForTesting( customFolderName );
		}
		const localPath = await modal.localPathInput.inputValue();

		if ( runtime ) {
			await modal.selectRuntime( runtime );
		}

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
