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
	} );
} );
