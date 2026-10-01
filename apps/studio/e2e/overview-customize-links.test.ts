import { test, expect, type Page } from '@playwright/test';
import { E2ESession, launchWithSite } from './e2e-helpers';
import SiteOverview from './page-objects/site-overview';
import { getUrlWithAutoLogin } from './utils';

test.describe( 'Overview shortcuts', () => {
	const session = new E2ESession();
	const siteName = 'E2E-Shortcuts-Site';

	const shortcuts = () =>
		session.mainWindow.locator( 'section' ).filter( {
			has: session.mainWindow.getByRole( 'heading', { name: 'Shortcuts', exact: true } ),
		} );

	// The URL the site preview's webview shows, once it has left the auto-login redirect.
	const getPreviewUrl = async ( expected: RegExp ) => {
		let previewUrl = '';
		await expect
			.poll(
				async () => {
					const urls = await session.electronApp.evaluate( ( { webContents } ) =>
						webContents
							.getAllWebContents()
							.filter( ( contents ) => contents.getType() === 'webview' )
							.map( ( contents ) => contents.getURL() )
					);
					previewUrl =
						urls.find(
							( url ) =>
								! url.includes( 'studio-auto-login' ) && expected.test( decodeURIComponent( url ) )
						) ?? '';
					return previewUrl;
				},
				{ timeout: 120_000 }
			)
			.toBeTruthy();
		return previewUrl;
	};

	// Opens a shortcut in the site preview and loads the same page in the test browser.
	const openShortcut = async ( page: Page, label: string, expected: RegExp ) => {
		await shortcuts().getByRole( 'button', { name: label } ).click();
		await page.goto( getUrlWithAutoLogin( await getPreviewUrl( expected ) ), {
			waitUntil: 'domcontentloaded',
		} );
	};

	test.beforeAll( async () => {
		await launchWithSite( session, { siteName } );
		await new SiteOverview( session.mainWindow ).open( siteName );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'shows block theme shortcuts for a new site', async () => {
		for ( const label of [
			'Site Editor',
			'Styles',
			'Patterns',
			'Navigation',
			'Templates',
			'Pages',
		] ) {
			await expect( shortcuts().getByRole( 'button', { name: label } ) ).toBeEnabled( {
				timeout: 120_000,
			} );
		}
	} );

	test( 'opens Site Editor shortcut', async ( { page } ) => {
		await openShortcut( page, 'Site Editor', /\/wp-admin\/site-editor\.php/ );
		await expect( page.getByRole( 'heading', { name: 'Design' } ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );

	test( 'opens Styles shortcut', async ( { page } ) => {
		await openShortcut( page, 'Styles', /site-editor\.php\?(path=\/wp_global_styles|p=\/styles)/ );
		await expect( page.getByRole( 'heading', { name: 'Design' } ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );

	test( 'opens Patterns shortcut', async ( { page } ) => {
		await openShortcut( page, 'Patterns', /site-editor\.php\?(path=\/patterns|p=\/pattern)/ );
		await expect( page.getByRole( 'heading', { name: 'All patterns' } ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );

	test( 'opens Navigation shortcut', async ( { page } ) => {
		await openShortcut( page, 'Navigation', /site-editor\.php\?(path|p)=\/navigation/ );
		await expect( page.getByRole( 'heading', { name: 'Navigation' } ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );

	test( 'opens Templates shortcut', async ( { page } ) => {
		await openShortcut( page, 'Templates', /site-editor\.php\?(path=\/wp_template|p=\/template)/ );
		await expect( page.locator( 'h1', { hasText: 'Templates' } ) ).toBeVisible( {
			timeout: 120_000,
		} );
	} );

	test( 'opens Pages shortcut', async ( { page } ) => {
		await openShortcut( page, 'Pages', /\/wp-admin\/edit\.php\?post_type=page/ );
		await expect( page.locator( 'h1', { hasText: 'Pages' } ) ).toBeVisible( { timeout: 120_000 } );
	} );

	test( 'opens phpMyAdmin in the browser', async ( { page } ) => {
		await session.electronApp.evaluate( ( { shell } ) => {
			const state = globalThis as typeof globalThis & { __e2eOpened?: string };
			shell.openExternal = async ( url: string ) => {
				state.__e2eOpened = url;
			};
		} );

		await session.mainWindow.getByRole( 'button', { name: 'phpMyAdmin' } ).click();
		let openedUrl = '';
		await expect
			.poll( async () => {
				openedUrl =
					( await session.electronApp.evaluate(
						() => ( globalThis as typeof globalThis & { __e2eOpened?: string } ).__e2eOpened
					) ) ?? '';
				return openedUrl;
			} )
			.toContain( 'phpmyadmin' );

		// Already wrapped in the auto-login redirect.
		await page.goto( openedUrl, { waitUntil: 'domcontentloaded' } );
		await expect( page.locator( '#page_content' ) ).toBeVisible( { timeout: 120_000 } );
	} );
} );
