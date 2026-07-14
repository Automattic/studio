import { test, expect, type Page } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import Onboarding from './page-objects/onboarding';
import SiteContent from './page-objects/site-content';
import { getUrlWithAutoLogin } from './utils';

const global = globalThis as unknown as {
	__originalOpenExternal?: ( url: string ) => Promise< void >;
	__openExternalCall?: string | null;
};
test.describe( 'Overview customize links', () => {
	const session = new E2ESession();

	const siteName = 'E2E-Shortcuts-Site';

	const mockOpenExternal = async () => {
		await session.electronApp.evaluate( ( { shell } ) => {
			if ( ! global.__originalOpenExternal ) {
				global.__originalOpenExternal = shell.openExternal;
			}
			global.__openExternalCall = null;
			shell.openExternal = async ( url: string ) => {
				global.__openExternalCall = url;
			};
		} );
	};

	const getOpenExternalCall = async (): Promise< string | null > => {
		return await session.electronApp.evaluate( () => {
			return global.__openExternalCall ?? null;
		} );
	};

	const restoreOpenExternal = async () => {
		await session.electronApp.evaluate( ( { shell } ) => {
			if ( global.__originalOpenExternal ) {
				shell.openExternal = global.__originalOpenExternal;
			}
			delete global.__openExternalCall;
			delete global.__originalOpenExternal;
		} );
	};

	const openShortcut = async ( page: Page, label: string ) => {
		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );

		await mockOpenExternal();

		await siteContent.locator.getByRole( 'button', { name: label } ).click();

		const openedUrl = await getOpenExternalCall();

		expect( openedUrl ).toBeTruthy();
		if ( ! openedUrl ) {
			throw new Error( 'openExternal was not called' );
		}

		await page.goto( getUrlWithAutoLogin( openedUrl ), {
			waitUntil: 'domcontentloaded',
		} );
		// Decode URL-encoded characters to normalize the URL across platforms
		// Need to decode multiple times due to nested redirect_to parameters
		let url = page.url();
		let decoded = decodeURIComponent( url );
		while ( decoded !== url ) {
			url = decoded;
			decoded = decodeURIComponent( url );
		}
		return decoded;
	};

	test.beforeAll( async () => {
		await session.launch();

		const onboarding = new Onboarding( session.mainWindow );
		await onboarding.completeOnboarding( { customSiteName: siteName } );
		await onboarding.closeWhatsNew();

		const siteContent = new SiteContent( session.mainWindow, siteName );
		await expect( siteContent.siteNameHeading ).toBeVisible( { timeout: 120_000 } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		if ( session.electronApp ) {
			await restoreOpenExternal();
		}
		await session.cleanup();
	} );

	test.describe( 'Block theme customize shortcut links', () => {
		test( 'shows overview shortcuts for a new site', async () => {
			const siteContent = new SiteContent( session.mainWindow, siteName );
			await expect( siteContent.runningButton ).toBeAttached( { timeout: 120_000 } );
			await expect( siteContent.siteNameHeading ).toBeVisible();

			const customizeHeading = siteContent.locator.getByRole( 'heading', { name: 'Customize' } );
			await expect( customizeHeading ).toBeVisible( { timeout: 120_000 } );

			const buttonMatchers: Array< string | RegExp > = [
				'Site Editor',
				'Styles',
				'Patterns',
				'Navigation',
				'Templates',
				'Pages',
			];

			for ( const matcher of buttonMatchers ) {
				await expect( siteContent.locator.getByRole( 'button', { name: matcher } ) ).toBeVisible( {
					timeout: 120_000,
				} );
			}
		} );

		test( 'opens Site Editor shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Site Editor' );
			expect( redirectUrl ).toContain( '/wp-admin/site-editor.php' );

			const headingLocator = page.getByRole( 'heading', {
				name: 'Design',
			} );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );

		test( 'opens Styles shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Styles' );
			// WordPress may use either path= or p= parameter depending on platform
			expect( redirectUrl ).toMatch(
				/\/wp-admin\/site-editor\.php\?(path=\/wp_global_styles|p=\/styles)/
			);

			const headingLocator = page.getByRole( 'heading', {
				name: 'Design',
			} );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );

		test( 'opens Patterns shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Patterns' );
			// WordPress may use either path= or p= parameter depending on platform
			expect( redirectUrl ).toMatch(
				/\/wp-admin\/site-editor\.php\?(path=\/patterns|p=\/pattern)/
			);

			const headingLocator = page.getByRole( 'heading', {
				name: 'All patterns',
			} );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );

		test( 'opens Navigation shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Navigation' );
			// WordPress may use either path= or p= parameter depending on platform
			expect( redirectUrl ).toMatch(
				/\/wp-admin\/site-editor\.php\?(path=\/navigation|p=\/navigation)/
			);

			const headingLocator = page.getByRole( 'heading', {
				name: 'Navigation',
			} );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );

		test( 'opens Templates shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Templates' );
			// WordPress may use either path= or p= parameter depending on platform
			expect( redirectUrl ).toMatch(
				/\/wp-admin\/site-editor\.php\?(path=\/wp_template|p=\/template)/
			);

			const headingLocator = page.locator( 'h1', { hasText: 'Templates' } );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );

		test( 'opens Pages shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'Pages' );
			// WordPress may use either path= or p= parameter depending on platform
			expect( redirectUrl ).toMatch( /\/wp-admin\/site-editor\.php\?(path=\/page|p=\/page)/ );

			const headingLocator = page.locator( 'h1', { hasText: 'Pages' } );
			await expect( headingLocator ).toBeVisible( { timeout: 120_000 } );
		} );
	} );

	test.describe( 'phpMyAdmin shortcut link', () => {
		test( 'phpMyAdmin button is visible and enabled for a new site', async () => {
			const siteContent = new SiteContent( session.mainWindow, siteName );
			const phpMyAdminButton = siteContent.locator.getByRole( 'button', { name: 'phpMyAdmin' } );
			await expect( phpMyAdminButton ).toBeVisible( { timeout: 120_000 } );
			await expect( phpMyAdminButton ).toBeEnabled();
		} );

		test( 'opens phpMyAdmin shortcut', async ( { page } ) => {
			const redirectUrl = await openShortcut( page, 'phpMyAdmin' );
			expect( redirectUrl ).toContain( '/phpmyadmin/' );

			// phpMyAdmin renders a table of database tables
			await expect( page.locator( '#pma_navigation' ) ).toBeVisible( { timeout: 120_000 } );
		} );
	} );
} );
