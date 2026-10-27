import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';

test.describe( 'Electron app', () => {
	test.describe.configure( { mode: 'serial' } );
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch( {}, { firstRun: true, appData: { colorScheme: 'system' } } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'first launch welcomes, then opens Add site', async ( { page: _page }, testInfo ) => {
		expect( await session.mainWindow.title() ).toBe( 'WordPress Studio' );
		const welcome = session.mainWindow.getByRole( 'dialog', {
			name: 'Welcome to WordPress Studio',
		} );
		await expect( welcome ).toBeVisible();
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await session.electronApp.evaluate( ( { BrowserWindow } ) => {
				BrowserWindow.getAllWindows()[ 0 ].setSize( 900, 680 );
			} );
			await session.mainWindow.emulateMedia( { colorScheme: theme } );
			await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
				'data-color-scheme',
				theme
			);
			await session.mainWindow.screenshot( {
				animations: 'disabled',
				path: testInfo.outputPath( `welcome-${ theme }.png` ),
			} );
		}
		await welcome.getByRole( 'button', { name: 'Close', exact: true } ).click();
		await expect( session.mainWindow.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
		await session.mainWindow.keyboard.press( 'Escape' );
		await expect( session.mainWindow.getByRole( 'dialog', { name: 'Add site' } ) ).toBeHidden();
		await session.restart();
		await expect( session.mainWindow.getByRole( 'dialog', { name: 'Add site' } ) ).toBeVisible();
		await session.mainWindow.keyboard.press( 'Escape' );
		await expect( session.mainWindow.getByRole( 'dialog', { name: 'Add site' } ) ).toBeHidden();
		expect( await session.mainWindow.evaluate( () => window.ipcApi.getOnboardingData() ) ).toBe(
			true
		);
		expect(
			await session.mainWindow.evaluate( () => window.ipcApi.getOnboardingHints() )
		).toMatchObject( {
			whatsNewSeenVersion: 1,
		} );
		await expect( session.mainWindow.getByRole( 'alertdialog' ) ).toBeHidden();
		await expect(
			session.mainWindow.getByRole( 'dialog', { name: 'What’s New in Studio' } )
		).toBeHidden();
	} );

	test( 'desktop Help reopens What’s New', async ( { page: _page }, testInfo ) => {
		test.skip(
			process.platform !== 'darwin',
			'The packaged app exposes its native Help menu on macOS.'
		);
		await session.electronApp.evaluate( ( { Menu, BrowserWindow } ) => {
			const help = Menu.getApplicationMenu()?.items.find( ( item ) => item.role === 'help' );
			const announcement = help?.submenu?.items.find( ( item ) => item.label === "What's New" );
			if ( ! announcement ) throw new Error( 'Missing What’s New menu item' );
			announcement.click( announcement, BrowserWindow.getAllWindows()[ 0 ], {} );
		} );
		const dialog = session.mainWindow.getByRole( 'dialog', { name: 'What’s New in Studio' } );
		await expect( dialog ).toBeVisible();
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await session.mainWindow.emulateMedia( { colorScheme: theme } );
			await expect( session.mainWindow.locator( 'html' ) ).toHaveAttribute(
				'data-color-scheme',
				theme
			);
			await session.mainWindow.screenshot( {
				animations: 'disabled',
				path: testInfo.outputPath( `whats-new-${ theme }.png` ),
			} );
		}
		await dialog.getByRole( 'button', { name: 'Done' } ).click();
		await expect( dialog ).toBeHidden();
	} );
} );
