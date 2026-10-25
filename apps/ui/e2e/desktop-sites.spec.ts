import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, previewText } from './desktop-app';

test( 'creates, previews, stops, restarts and relaunches a WordPress site in both themes', async ( {
	browserName,
}, info ) => {
	expect( browserName ).toBe( 'chromium' );
	const session = await createSession();
	let launched = await launch( session );
	try {
		const { page, app } = launched;
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await expect( page ).toHaveURL( /\/dist\/renderer-ui\/index.html#\// );
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
		await expect( page.getByLabel( 'Loading site preview' ) ).toBeHidden();
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
		const openedUrl = new URL( ( await urls() )[ 0 ] );
		expect( openedUrl.pathname ).toBe( '/' );
		const guestId = await page
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		await page.getByRole( 'button', { name: 'More preview actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Reload preview', exact: true } ).click();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await expect(
			page
				.locator( 'webview' )
				.evaluate( ( element ) =>
					( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
				)
		).resolves.toBe( guestId );
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
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( colorScheme ) => window.ipcApi.setUserPreferences( { colorScheme: colorScheme } ),
				theme
			);
			await page.reload();
			await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', theme );
			await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
			await page.screenshot( { path: info.outputPath( `${ theme }-preview.png` ) } );
			await page
				.getByRole( 'button', { name: 'Site actions for Experimental verification', exact: true } )
				.click();
			await expect( page.getByRole( 'menuitem', { name: 'Settings', exact: true } ) ).toBeVisible();
			await page.screenshot( { path: info.outputPath( `${ theme }-menu.png` ) } );
			await page.keyboard.press( 'Escape' );
			await page
				.getByRole( 'button', { name: 'Stop Experimental verification', exact: true } )
				.click();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toHaveCount( 0 );
			await expect( page.locator( 'main header[data-site-header]' ) ).toBeVisible();
			await expect(
				page.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
			).toBeEnabled();
			await expect( page.getByRole( 'button', { name: 'Connect' } ) ).toBeVisible();
			await page.screenshot( { path: info.outputPath( `${ theme }-stopped-chat.png` ) } );
			await expect(
				page.getByRole( 'button', { name: 'Expand preview', exact: true } )
			).toHaveCount( 0 );
			await expect( page.getByRole( 'button', { name: 'Hide chat', exact: true } ) ).toHaveCount(
				0
			);
			await page
				.getByRole( 'button', { name: 'Start Experimental verification', exact: true } )
				.click();
			await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		}
		for ( const width of [ 800, 1440 ] ) {
			await app.evaluate( ( { BrowserWindow }, windowWidth ) => {
				BrowserWindow.getAllWindows()[ 0 ].setContentSize( windowWidth, 800 );
			}, width );
			await expect.poll( () => page.evaluate( () => innerWidth ) ).toBe( width );
			await page.screenshot( { path: info.outputPath( `preview-${ width }.png` ) } );
		}
		await app.close();
		launched = await launch( session );
		await expect(
			launched.page.getByRole( 'button', {
				name: 'Site actions for Experimental verification',
				exact: true,
			} )
		).toBeVisible();
		await expect(
			launched.page
				.locator( 'main header[data-site-header]' )
				.getByRole( 'button', { name: 'Start', exact: true } )
		).toHaveCount( 0 );
		await launched.page
			.getByRole( 'button', { name: 'Start Experimental verification', exact: true } )
			.click();
		await expect
			.poll( () => previewText( launched.app, launched.page ) )
			.toContain( 'Hello world!' );
		await launched.page.evaluate( async () => {
			await window.ipcApi.setUserPreferences( { quitSitesBehavior: 'stop-and-auto-start' } );
		} );
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

test( 'offers site creation on empty desktop launch in both themes', async ( {
	browserName,
}, info ) => {
	expect( browserName ).toBe( 'chromium' );
	const session = await createSession();
	const { app, page } = await launch( session );
	// Keep physical pointer movement from interfering with CDP input during local runs.
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].setIgnoreMouseEvents( true );
	} );
	try {
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( colorScheme ) => window.ipcApi.setUserPreferences( { colorScheme: colorScheme } ),
				scheme
			);
			await page.evaluate( () =>
				window.ipcApi.setUserPreferences( { newSiteBehavior: 'choose' } )
			);
			await page.evaluate( () => history.replaceState( null, '', '#/' ) );
			await page.reload();
			await page.bringToFront();
			const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
			await expect( dialog ).toBeVisible();
			await expect(
				page.getByRole( 'button', { name: 'Settings', exact: true, includeHidden: true } )
			).toHaveCSS( 'visibility', 'visible' );
			await expect(
				page.getByRole( 'button', { name: 'Hide sidebar', exact: true, includeHidden: true } )
			).toHaveCSS( 'visibility', 'visible' );
			await expect( dialog.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeFocused();
			await expect.poll( async () => ( await dialog.boundingBox() )?.height ).toBe( 624 );
			const bounds = ( await dialog.boundingBox() )!;
			const viewportHeight = await page.evaluate( () => window.innerHeight );
			expect( bounds.y ).toBeGreaterThanOrEqual( 16 );
			expect( bounds.y + bounds.height ).toBeLessThanOrEqual( viewportHeight - 16 );
			await dialog.getByRole( 'tab', { name: 'Portfolio', exact: true } ).click();
			await expect( dialog.getByRole( 'heading', { name: 'Portfolio', level: 1 } ) ).toBeVisible();
			await expect( dialog.getByRole( 'button', { name: 'Blueprints', exact: true } ) ).toHaveCount(
				0
			);
			await page.screenshot( { path: info.outputPath( `category-desktop-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'Back to Blueprints' } ).click();
			await expect( dialog.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeVisible();
			await dialog.getByRole( 'tab', { name: 'Portfolio', exact: true } ).click();
			await dialog.getByRole( 'button', { name: 'Back to Blueprints', exact: true } ).click();
			await expect( dialog.getByRole( 'tab', { name: 'Create', exact: true } ) ).toHaveAttribute(
				'aria-selected',
				'true'
			);
			const wedding = dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } );
			const viewBlueprint = wedding.getByText( 'View blueprint', { exact: true } ).locator( '..' );
			await expect( viewBlueprint ).toHaveCSS( 'opacity', '0' );
			await wedding.hover();
			await expect( viewBlueprint ).toHaveCSS( 'opacity', '1' );
			await expect( wedding.getByRole( 'img' ) ).toHaveCSS( 'opacity', '0.7' );
			await page.screenshot( { path: info.outputPath( `picker-desktop-${ scheme }.png` ) } );
			await page.mouse.move( 0, 0 );
			await page.keyboard.press( 'Tab' );
			await wedding.focus();
			await expect( viewBlueprint ).toHaveCSS( 'opacity', '1' );
			await wedding.press( 'Enter' );
			await expect(
				dialog.getByRole( 'heading', { name: 'Wedding RSVP', level: 1 } )
			).toBeVisible();
			await expect( dialog.getByRole( 'tablist' ) ).toHaveCount( 0 );
			await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toBeFocused();
			await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toHaveAttribute(
				'data-variant',
				'accent'
			);
			const closeInsets = await dialog
				.getByRole( 'button', { name: 'Close Add site' } )
				.evaluate( ( button ) => {
					const surface = button.closest( '[role="dialog"]' )!.getBoundingClientRect();
					const close = button.getBoundingClientRect();
					return { top: close.top - surface.top, right: surface.right - close.right };
				} );
			expect( closeInsets.right ).toBeCloseTo( closeInsets.top, 0 );
			const backInsets = await dialog
				.getByRole( 'button', { name: 'Back to Blueprints' } )
				.evaluate( ( button ) => {
					const surface = button.closest( '[role="dialog"]' )!.getBoundingClientRect();
					const back = button.getBoundingClientRect();
					return { top: back.top - surface.top, left: back.left - surface.left };
				} );
			expect( backInsets.left ).toBe( 16 );
			expect( backInsets.top ).toBe( 14 );
			await expect
				.poll( () =>
					dialog
						.getByRole( 'img', { name: 'Wedding RSVP screenshot' } )
						.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
				)
				.toBeGreaterThan( 0 );
			await expect( dialog.getByRole( 'img' ) ).toHaveCount( 1 );
			await expect( dialog.getByRole( 'img' ) ).toHaveAccessibleName( 'Wedding RSVP screenshot' );
			expect(
				await dialog
					.locator( '[data-slot="dialog-scroll-area"]' )
					.evaluate( ( element ) => element.scrollHeight - element.clientHeight )
			).toBeLessThan( 2 );
			await page.screenshot( {
				path: info.outputPath( `blueprint-details-desktop-${ scheme }.png` ),
			} );
			const useBounds = ( await dialog
				.getByRole( 'button', { name: 'Create site' } )
				.boundingBox() )!;
			const closeBounds = ( await dialog
				.getByRole( 'button', { name: 'Close Add site' } )
				.boundingBox() )!;
			expect( useBounds.x + useBounds.width ).toBeLessThanOrEqual( closeBounds.x );
			await dialog.getByRole( 'button', { name: 'Back to Blueprints', exact: true } ).click();
			await expect(
				dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
			).toBeFocused();
			await dialog.getByRole( 'button', { name: 'View Stylish Press', exact: true } ).click();
			await expect( dialog.getByRole( 'img' ) ).toHaveCount( 1 );
			await expect( dialog.getByRole( 'img' ) ).toHaveAccessibleName( 'Stylish Press screenshot' );
			await expect
				.poll( () =>
					dialog
						.getByRole( 'img' )
						.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
				)
				.toBeGreaterThan( 0 );
			await page.screenshot( { path: info.outputPath( `stylish-press-desktop-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'Back to Blueprints' } ).click();
			await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
			await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
			await expect( dialog.getByRole( 'tablist' ) ).toHaveCount( 0 );
			await dialog.getByLabel( 'Site name' ).fill( 'Preserved setup draft' );
			await dialog.getByRole( 'button', { name: 'Back', exact: true } ).click();
			await expect( dialog.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).toBeVisible();
			await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
			await page.screenshot( { path: info.outputPath( `empty-desktop-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
			await expect( dialog ).toBeHidden();
			await expect(
				page.getByRole( 'button', { name: 'Add site', exact: true } ).last()
			).toBeFocused();
			await expect( page.getByText( 'Add a local WordPress site to get started.' ) ).toBeVisible();
			await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
			await expect( page.getByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
			await page.getByRole( 'button', { name: 'Close settings' } ).click();
			await expect( page.getByRole( 'dialog' ) ).toBeHidden();
			await page.getByRole( 'button', { name: 'Add site', exact: true } ).last().click();
			await expect( dialog ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await expect( dialog ).toBeHidden();
		}
		await page.evaluate( () => window.ipcApi.setUserPreferences( { newSiteBehavior: 'blank' } ) );
		await page.evaluate( () => history.replaceState( null, '', '#/' ) );
		await page.reload();
		const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await dialog.getByLabel( 'Site name' ).fill( 'First site verification' );
		await dialog.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( dialog ).toBeHidden( { timeout: 90_000 } );
		await expect(
			page.getByRole( 'button', { name: 'Stop First site verification' } )
		).toBeEnabled();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( theme ) => window.ipcApi.setUserPreferences( { colorScheme: theme } ),
				scheme
			);
			await page.reload();
			const composer = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
			if ( ! ( await composer.isVisible() ) ) {
				await page
					.getByRole( 'button', { name: 'New chat for First site verification', exact: true } )
					.click();
			}
			await composer.fill( 'Keep this draft while adding another site' );
			await page.getByRole( 'button', { name: 'Add site', exact: true } ).click();
			await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
			expect( ( await dialog.boundingBox() )!.x ).toBeGreaterThan( 0 );
			await dialog.getByRole( 'button', { name: 'Back', exact: true } ).click();
			await page.screenshot( { path: info.outputPath( `additional-site-${ scheme }.png` ) } );
			await page.keyboard.press( 'Escape' );
			await expect( dialog ).toBeHidden();
			await expect( composer ).toHaveValue( 'Keep this draft while adding another site' );
		}
		await page.getByRole( 'button', { name: 'Add site', exact: true } ).click();
		await app.evaluate( ( { BrowserWindow } ) => {
			BrowserWindow.getAllWindows()[ 0 ].setContentSize( 800, 700 );
		} );
		await expect( dialog.getByLabel( 'Site name' ) ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'additional-site-narrow.png' ) } );
		await page.keyboard.press( 'Escape' );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true } );
	}
} );

test( 'remove site confirmation keeps consequences readable and focus contained in both themes', async ( {
	browserName,
}, info ) => {
	expect( browserName ).toBe( 'chromium' );
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
		await app.evaluate( ( { BrowserWindow } ) =>
			BrowserWindow.getAllWindows()[ 0 ].webContents.setZoomFactor( 1 )
		);
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( theme ) => window.ipcApi.setUserPreferences( { colorScheme: theme } ),
				scheme
			);
			await page.reload();
			await page.getByRole( 'button', { name: 'Pitch', exact: true } ).click();
			const trigger = page.getByRole( 'button', { name: 'Site actions for Pitch', exact: true } );
			await trigger.click();
			await page.getByRole( 'menuitem', { name: 'Delete site', exact: true } ).click();
			const dialog = page.getByRole( 'alertdialog', {
				name: 'Remove “Pitch” from WordPress Studio?',
				exact: true,
			} );
			const cancel = dialog.getByRole( 'button', { name: 'Cancel', exact: true } );
			await expect( cancel ).toBeFocused();
			await dialog.evaluate( async ( element ) => {
				await Promise.all( element.getAnimations().map( ( animation ) => animation.finished ) );
			} );
			const insets = await dialog.evaluate( ( element ) => {
				const bounds = element.getBoundingClientRect();
				const close = element
					.querySelector( 'button[aria-label="Close"]' )!
					.getBoundingClientRect();
				const footer = element
					.querySelector( '[data-slot=dialog-footer]' )!
					.getBoundingClientRect();
				return [
					close.top - bounds.top,
					bounds.right - close.right,
					footer.left - bounds.left,
					bounds.right - footer.right,
					bounds.bottom - footer.bottom,
				];
			} );
			for ( const inset of insets ) expect( inset ).toBeCloseTo( 14, 0 );

			const description = dialog.locator( '[data-slot=dialog-description]' );
			await expect( description ).toContainText(
				'Are you sure you want to remove this site and delete its chats and any shared preview sites?'
			);
			await expect( description ).toHaveAttribute( 'data-tone', 'default' );
			await expect( description ).toContainText( 'any shared preview sites' );
			await dialog.getByRole( 'checkbox' ).check();
			await expect( description ).toContainText(
				'Are you sure you want to remove this site and delete its chats and any shared preview sites?'
			);
			await expect(
				dialog.getByRole( 'button', { name: 'Remove site', exact: true } )
			).toBeEnabled();
			for ( let step = 0; step < 6; step++ ) {
				await page.keyboard.press( 'Tab' );
				await expect
					.poll( () =>
						dialog.evaluate( ( element ) => element.contains( document.activeElement ) )
					)
					.toBe( true );
			}
			await dialog.screenshot( {
				path: info.outputPath( `remove-site-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await page.keyboard.press( 'Escape' );
			await expect( dialog ).toBeHidden();
			await expect( trigger ).toBeFocused();
		}
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true } );
	}
} );
