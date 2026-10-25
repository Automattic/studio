import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, previewText } from './desktop-app';

test( 'creates, previews, stops, restarts and relaunches a WordPress site', async () => {
	const info = test.info();
	const session = await createSession();
	let launched = await launch( session );
	try {
		const { page, app } = launched;
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await expect( page.getByRole( 'textbox', { name: 'Site name', exact: true } ) ).toBeFocused();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Experimental verification' );
		await page.getByRole( 'button', { name: 'Advanced settings' } ).click();
		await expect( page.getByRole( 'textbox', { name: 'Local path' } ) ).toHaveValue(
			path.join( session.home, 'Studio', 'experimental-verification' )
		);
		await page
			.getByRole( 'dialog', { name: 'Add site', exact: true } )
			.getByRole( 'button', { name: 'Create site', exact: true } )
			.click();
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeHidden( {
			timeout: 90_000,
		} );
		await expect(
			page.getByRole( 'button', { name: 'Stop Experimental verification', exact: true } )
		).toBeEnabled();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		await app.evaluate( ( { shell } ) => {
			const captured = globalThis as typeof globalThis & { openedUrls: string[] };
			captured.openedUrls = [];
			shell.openExternal = async ( url ) => {
				captured.openedUrls.push( url );
			};
		} );
		await page.getByRole( 'textbox', { name: 'Address' } ).hover();
		await page.getByRole( 'button', { name: 'More preview actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Open in browser', exact: true } ).click();
		const urls = () =>
			app.evaluate(
				() => ( globalThis as typeof globalThis & { openedUrls: string[] } ).openedUrls
			);
		await expect.poll( urls ).toHaveLength( 1 );
		expect( new URL( ( await urls() )[ 0 ] ).pathname ).toBe( '/' );

		const guestId = await page
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		await page.getByRole( 'button', { name: 'More preview actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Reload preview', exact: true } ).click();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		const originalUrl = await app.evaluate(
			( { webContents }, id ) => webContents.fromId( id )!.getURL(),
			guestId
		);
		await app.evaluate( async ( { webContents }, id ) => {
			await webContents
				.fromId( id )!
				.loadURL( 'http://127.0.0.1:1/' )
				.catch( () => {} );
		}, guestId );
		await expect( page.getByText( 'Preview could not load' ) ).toBeVisible();
		await page.getByRole( 'button', { name: 'Try again' } ).click();
		await expect( page.getByText( 'Preview could not load' ) ).toBeVisible();
		await app.evaluate(
			async ( { webContents }, target ) => {
				await webContents.fromId( target.id )!.loadURL( target.url );
			},
			{ id: guestId, url: originalUrl }
		);
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		await page
			.getByRole( 'button', { name: 'Stop Experimental verification', exact: true } )
			.click();
		await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toHaveCount( 0 );
		await expect(
			page.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
		).toBeEnabled();
		await page
			.getByRole( 'button', { name: 'Start Experimental verification', exact: true } )
			.click();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		await app.close();
		launched = await launch( session );
		await expect(
			launched.page.getByRole( 'button', {
				name: 'Start Experimental verification',
				exact: true,
			} )
		).toBeVisible();
		await launched.page
			.getByRole( 'button', { name: 'Start Experimental verification', exact: true } )
			.click();
		await expect
			.poll( () => previewText( launched.app, launched.page ) )
			.toContain( 'Hello world!' );
		await launched.page.evaluate( () =>
			window.ipcApi.setUserPreferences( { quitSitesBehavior: 'stop-and-auto-start' } )
		);
		await launched.app.close();
		launched = await launch( session );
		await expect(
			launched.page.getByRole( 'button', { name: 'Stop Experimental verification', exact: true } )
		).toBeEnabled();
		await expect
			.poll( () => previewText( launched.app, launched.page ) )
			.toContain( 'Hello world!' );
		expect( launched.errors ).toEqual( [] );
	} catch ( error ) {
		await launched.page.screenshot( { path: info.outputPath( 'failure.png' ) } );
		console.error( launched.logs().slice( -6000 ) );
		throw error;
	} finally {
		await launched.app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'offers site creation from an empty desktop launch', async () => {
	const session = await createSession();
	const { app, page } = await launch( session );
	// Keep physical pointer movement from interfering with CDP input during local runs.
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].setIgnoreMouseEvents( true );
	} );
	try {
		await page.evaluate( () => window.ipcApi.setUserPreferences( { newSiteBehavior: 'choose' } ) );
		await page.evaluate( () => history.replaceState( null, '', '#/' ) );
		await page.reload();
		const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await expect( dialog ).toBeVisible();
		await expect( dialog.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeFocused();

		await dialog.getByRole( 'tab', { name: 'Portfolio', exact: true } ).click();
		await expect( dialog.getByRole( 'heading', { name: 'Portfolio', level: 1 } ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Back to Blueprints' } ).click();
		await expect( dialog.getByRole( 'tab', { name: 'Create', exact: true } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);

		await dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } ).click();
		await expect( dialog.getByRole( 'heading', { name: 'Wedding RSVP', level: 1 } ) ).toBeVisible();
		await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toBeFocused();
		await expect
			.poll( () =>
				dialog
					.getByRole( 'img', { name: 'Wedding RSVP screenshot' } )
					.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
			)
			.toBeGreaterThan( 0 );
		await dialog.getByRole( 'button', { name: 'Back to Blueprints', exact: true } ).click();
		await expect(
			dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
		).toBeFocused();

		await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
		await dialog.getByRole( 'button', { name: 'Back', exact: true } ).click();
		await expect( dialog.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		await dialog.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		await expect( dialog ).toBeHidden();
		await expect( page.getByText( 'Add a local WordPress site to get started.' ) ).toBeVisible();

		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
		await page.getByRole( 'button', { name: 'Close settings' } ).click();
		await expect( page.getByRole( 'dialog' ) ).toBeHidden();
		await page.getByRole( 'button', { name: 'Add site', exact: true } ).last().click();
		await expect( dialog ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();

		await page.evaluate( () => window.ipcApi.setUserPreferences( { newSiteBehavior: 'blank' } ) );
		await page.evaluate( () => history.replaceState( null, '', '#/' ) );
		await page.reload();
		await dialog.getByLabel( 'Site name' ).fill( 'First site verification' );
		await dialog.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( dialog ).toBeHidden( { timeout: 90_000 } );
		await expect(
			page.getByRole( 'button', { name: 'Stop First site verification' } )
		).toBeEnabled();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		const composer = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await composer.fill( 'Keep this draft while adding another site' );
		await page.getByRole( 'button', { name: 'Add site', exact: true } ).click();
		await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( composer ).toHaveValue( 'Keep this draft while adding another site' );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'remove site confirmation explains consequences and keeps focus inside', async () => {
	const session = await createSession();
	const sitePath = path.join( session.home, 'Studio', 'removal-verification' );
	await mkdir( sitePath, { recursive: true } );
	await writeFile( path.join( sitePath, 'index.php' ), '' );
	const port = await portFinder.getOpenPort();
	await writeFile(
		path.join( session.config, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'removal-site',
					name: 'Pitch',
					path: sitePath,
					port,
					url: `http://localhost:${ port }`,
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		} )
	);
	const { app, page } = await launch( session );
	try {
		const sites = await page.evaluate( () => window.ipcApi.getSiteDetails() );
		await app.evaluate( ( { ipcMain }, siteDetails ) => {
			ipcMain.removeHandler( 'getSiteDetails' );
			ipcMain.handle( 'getSiteDetails', async () => siteDetails );
		}, sites );
		await page.reload();
		await page.getByRole( 'button', { name: 'Pitch', exact: true } ).click();
		const trigger = page.getByRole( 'button', { name: 'Site actions for Pitch', exact: true } );
		await trigger.click();
		await page.getByRole( 'menuitem', { name: 'Delete site', exact: true } ).click();
		const dialog = page.getByRole( 'alertdialog', {
			name: 'Remove “Pitch” from WordPress Studio?',
			exact: true,
		} );
		await expect( dialog.getByRole( 'button', { name: 'Cancel', exact: true } ) ).toBeFocused();
		await expect( dialog ).toContainText(
			'Are you sure you want to remove this site and delete its chats and any shared preview sites?'
		);
		await dialog.getByRole( 'checkbox' ).check();
		await expect(
			dialog.getByRole( 'button', { name: 'Remove site', exact: true } )
		).toBeEnabled();
		for ( let step = 0; step < 6; step++ ) {
			await page.keyboard.press( 'Tab' );
			await expect
				.poll( () => dialog.evaluate( ( element ) => element.contains( document.activeElement ) ) )
				.toBe( true );
		}
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( trigger ).toBeFocused();
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
