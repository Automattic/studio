import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import WhatsNewModal from './page-objects/whats-new-modal';

test.describe( 'Shortcut links', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Shortcuts-Site';

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await expect(onboarding.heading).toBeVisible();
		await onboarding.siteNameInput.fill( siteName );
		await onboarding.continueButton.click();

		const whatsNewModal = new WhatsNewModal( session.mainWindow );
		if ( await whatsNewModal.locator.isVisible( { timeout: 5000 } ) ) {
			await whatsNewModal.close();
		}

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'shows overview shortcuts for a new site', async () => {
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
		await expect( siteContent.siteNameHeading ).toBeVisible();

		const customizeHeading = siteContent.locator.getByRole( 'heading', { name: 'Customize' } );
		await expect( customizeHeading ).toBeVisible( { timeout: 120_000 } );

		const buttonMatchers: Array< string | RegExp > = [
			'Site',
			'Styles',
			'Patterns',
			'Navigation',
			'Templates',
			'Pages',
		];

		for ( const matcher of buttonMatchers ) {
			await expect( siteContent.locator.getByRole( 'button', { name: matcher } ) ).toBeVisible();
		}
	} );
} );

