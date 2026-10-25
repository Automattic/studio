import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, previewText } from './desktop-app';

test( 'preview sharing reuses the desktop screenshot and copies its link in both themes', async ( {
	browserName,
}, info ) => {
	void browserName;
	const session = await createSession();
	const { app, page, errors } = await launch( session );
	try {
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Sharing verification' );
		await page
			.getByRole( 'dialog', { name: 'Add site', exact: true } )
			.getByRole( 'button', { name: 'Create site', exact: true } )
			.click();
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeHidden( {
			timeout: 90_000,
		} );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await app.evaluate( ( { BrowserWindow } ) => {
			BrowserWindow.getAllWindows()[ 0 ].setContentSize( 1440, 900 );
		} );
		const site = await page.evaluate( async () => {
			const [ site ] = await window.ipcApi.getSiteDetails();
			return site;
		} );
		const guestId = await page
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		const screenshot = await page.evaluate(
			async ( { site, guestId } ) => window.ipcApi.captureSitePreview( site.id, guestId, '/' ),
			{ site, guestId }
		);
		expect( screenshot ).toMatch( /^data:image\/png;base64,/ );
		await app.evaluate( ( { ipcMain }, siteId ) => {
			ipcMain.removeHandler( 'getAuthenticationToken' );
			ipcMain.handle( 'getAuthenticationToken', () => ( {
				id: 1,
				email: 'sharing@example.com',
				displayName: 'Sharing verification',
			} ) );
			ipcMain.removeHandler( 'fetchSnapshots' );
			ipcMain.handle( 'fetchSnapshots', () => [
				{
					atomicSiteId: 9001,
					localSiteId: siteId,
					userId: 1,
					name: 'Client review',
					url: 'sharing-verification.wp.build',
					date: Date.now(),
				},
			] );
			ipcMain.removeHandler( 'getConnectedWpcomSites' );
			ipcMain.handle( 'getConnectedWpcomSites', () => [] );
			const captured = globalThis as typeof globalThis & { sharingCheckoutUrl?: string };
			ipcMain.removeAllListeners( 'openURL' );
			ipcMain.on( 'openURL', ( _event, url: string ) => {
				captured.sharingCheckoutUrl = url;
			} );
		}, site.id );
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await app.evaluate( ( { ipcMain } ) => {
				const captured = globalThis as typeof globalThis & { previewPublishHosts: string[] };
				captured.previewPublishHosts = [];
				ipcMain.removeHandler( 'publishPreviewSite' );
				ipcMain.handle( 'publishPreviewSite', async ( _event, _siteFolder, hostname ) => {
					captured.previewPublishHosts.push( hostname );
					return { url: 'https://sharing-verification.wp.build' };
				} );
			} );
			const publishedHosts = () =>
				app.evaluate(
					() =>
						( globalThis as typeof globalThis & { previewPublishHosts: string[] } )
							.previewPublishHosts
				);
			await page.evaluate(
				( theme ) => window.ipcApi.setUserPreferences( { colorScheme: theme } ),
				theme
			);
			await page.reload();
			await page.getByRole( 'button', { name: 'Share', exact: true } ).click();
			const dialog = page.getByRole( 'dialog', {
				name: 'Share',
				exact: true,
			} );
			await expect(
				dialog.getByRole( 'img', { name: 'Local site preview of Sharing verification' } )
			).toHaveAttribute( 'src', screenshot! );
			await expect( dialog.getByText( 'Anyone with the link can view this preview.' ) ).toHaveCount(
				0
			);
			await expect(
				dialog.getByText( 'sharing-verification.wp.build', { exact: true } )
			).toHaveCount( 0 );
			await expect( dialog.getByRole( 'button', { name: 'Open preview' } ) ).toHaveCount( 0 );
			await expect( dialog.getByRole( 'button', { name: 'View QR code' } ) ).toHaveCount( 0 );
			await expect( dialog.locator( 'figcaption' ) ).toHaveCount( 0 );
			const previewUrl = dialog.getByRole( 'textbox', { name: 'Preview link' } );
			await expect( previewUrl ).toHaveValue( 'https://sharing-verification.wp.build' );
			await expect( previewUrl ).toHaveAttribute( 'readonly', '' );
			await expect( dialog.getByRole( 'button', { name: 'Choose a plan' } ) ).toBeEnabled();
			await dialog.getByRole( 'button', { name: 'Copy link', exact: true } ).click();
			await expect( dialog.getByRole( 'button', { name: 'Copied', exact: true } ) ).toBeVisible();
			expect( await app.evaluate( ( { clipboard } ) => clipboard.readText() ) ).toBe(
				'https://sharing-verification.wp.build'
			);
			expect( await publishedHosts() ).toEqual( [] );
			await page.screenshot( {
				path: info.outputPath( `${ theme }-preview-sharing.png` ),
				animations: 'disabled',
			} );
			await dialog.getByRole( 'button', { name: 'Preview actions' } ).click();
			await expect( page.getByRole( 'menuitem', { name: 'Delete preview' } ) ).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `${ theme }-preview-actions.png` ),
				animations: 'disabled',
			} );
			await page.keyboard.press( 'Escape' );
			await dialog.getByRole( 'button', { name: 'Update preview' } ).click();
			await expect.poll( publishedHosts ).toEqual( [ 'sharing-verification.wp.build' ] );
			await expect( dialog.getByRole( 'button', { name: /^(Copy link|Copied)$/ } ) ).toBeEnabled();
			await page.keyboard.press( 'Escape' );
			await expect( dialog ).toBeHidden();
			await expect( page.getByRole( 'button', { name: 'Share', exact: true } ) ).toBeFocused();
			await page.getByRole( 'button', { name: 'Share', exact: true } ).click();
			await expect( dialog.getByRole( 'button', { name: /^(Copy link|Copied)$/ } ) ).toBeEnabled();
			expect( await publishedHosts() ).toEqual( [ 'sharing-verification.wp.build' ] );
			await dialog.getByRole( 'button', { name: 'Choose a plan' } ).click();
			await expect( dialog ).toBeHidden();
			const checkout = new URL(
				await app.evaluate(
					() =>
						( globalThis as typeof globalThis & { sharingCheckoutUrl: string } ).sharingCheckoutUrl
				)
			);
			expect( checkout.origin + checkout.pathname ).toBe(
				'https://wordpress.com/setup/new-hosted-site'
			);
			expect( checkout.searchParams.get( 'studioSiteId' ) ).toBe( site.id );
			expect( checkout.searchParams.get( 'showDomainStep' ) ).toBe( 'true' );
			expect( checkout.searchParams.get( 'autoOpenPush' ) ).toBe( 'true' );
			for ( const eligible of [ false, true, false ] ) {
				await app.evaluate( ( { ipcMain }, eligible ) => {
					ipcMain.removeHandler( 'getConnectedWpcomSites' );
					ipcMain.handle( 'getConnectedWpcomSites', () => [
						{
							id: 42,
							name: 'Connected hosting',
							url: 'https://connected.wordpress.com',
							isStaging: false,
							isPressable: false,
							syncSupport: 'already-connected',
							lastPullTimestamp: null,
							lastPushTimestamp: null,
						},
					] );
					ipcMain.removeHandler( 'fetchSyncableWpcomSites' );
					ipcMain.handle( 'fetchSyncableWpcomSites', () => [
						{ id: 42, hasStudioPublishingPlan: eligible, isPressable: false },
						{ id: 99, hasStudioPublishingPlan: true, isPressable: false },
					] );
				}, eligible );
				await page.getByRole( 'button', { name: 'Share', exact: true } ).click();
				await expect(
					dialog.getByRole( 'button', { name: 'Copy link', exact: true } )
				).toBeVisible();
				if ( ! eligible ) {
					await expect( dialog.getByRole( 'button', { name: 'Choose a plan' } ) ).toBeVisible();
				}
				await page.keyboard.press( 'Escape' );
				await expect( dialog ).toBeHidden();
			}
			await app.evaluate( ( { ipcMain } ) => {
				ipcMain.removeHandler( 'getConnectedWpcomSites' );
				ipcMain.handle( 'getConnectedWpcomSites', () => [] );
			} );
		}
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await app.evaluate( ( { ipcMain }, siteId ) => {
				let renewed = false;
				ipcMain.removeHandler( 'fetchSnapshots' );
				ipcMain.handle( 'fetchSnapshots', () => [
					{
						atomicSiteId: renewed ? 9002 : 9001,
						localSiteId: siteId,
						userId: 1,
						name: 'Client review',
						url: renewed ? 'new-sharing-verification.wp.build' : 'sharing-verification.wp.build',
						date: renewed ? Date.now() : Date.now() - 8 * 24 * 60 * 60 * 1000,
					},
				] );
				ipcMain.removeHandler( 'publishPreviewSite' );
				ipcMain.handle( 'publishPreviewSite', async () => {
					await new Promise< void >( ( resolve ) =>
						ipcMain.once( 'finish-preview-test', () => resolve() )
					);
					renewed = true;
					return { url: 'https://new-sharing-verification.wp.build' };
				} );
			}, site.id );
			await page.evaluate(
				( theme ) => window.ipcApi.setUserPreferences( { colorScheme: theme } ),
				theme
			);
			await page.reload();
			await page.getByRole( 'button', { name: 'Share', exact: true } ).click();
			const popover = page.getByRole( 'dialog', { name: 'Share', exact: true } );
			await popover.getByRole( 'button', { name: 'Create preview', exact: true } ).click();
			await expect(
				popover.getByRole( 'button', { name: 'Publishing preview…', exact: true } )
			).toBeDisabled();
			await page.keyboard.press( 'Escape' );
			await expect( popover ).toBeHidden();
			const share = page.getByRole( 'button', { name: 'Share', exact: true, includeHidden: true } );
			await expect( share ).toHaveAccessibleDescription( 'Publishing preview…' );
			await expect( share.locator( '[data-slot=spinner]' ) ).toHaveCount( 1 );
			await page.screenshot( {
				path: info.outputPath( `${ theme }-publishing-preview.png` ),
				animations: 'disabled',
			} );
			await expect
				.poll( () =>
					app.evaluate( ( { ipcMain } ) => ipcMain.listenerCount( 'finish-preview-test' ) )
				)
				.toBe( 1 );
			await app.evaluate( ( { ipcMain } ) => ipcMain.emit( 'finish-preview-test' ) );
			await expect( share ).toHaveAccessibleDescription( 'Preview ready' );
			await expect( share.locator( 'span[aria-hidden="true"]' ) ).toHaveCount( 1 );

			await expect(
				page.getByText( 'Sharing verification preview ready', { exact: true } ).first()
			).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `${ theme }-unread-preview.png` ),
				animations: 'disabled',
			} );
			await share.click();
			await expect( share ).not.toHaveAttribute( 'aria-description' );

			await expect( popover.getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
			await expect( popover.getByText( 'This preview has expired.' ) ).toHaveCount( 0 );
			await expect( popover.getByRole( 'button', { name: 'Create a new preview' } ) ).toHaveCount(
				0
			);
			await expect( popover.getByText( /^Expires / ) ).toBeVisible();
			await popover.getByRole( 'button', { name: 'Copy link' } ).click();
			await expect( popover.getByRole( 'button', { name: 'Copied' } ) ).toBeVisible();
			expect( await app.evaluate( ( { clipboard } ) => clipboard.readText() ) ).toBe(
				'https://new-sharing-verification.wp.build'
			);
			await page.screenshot( {
				path: info.outputPath( `${ theme }-replacement-preview.png` ),
				animations: 'disabled',
			} );
			await page.keyboard.press( 'Escape' );
			await expect( popover ).toBeHidden();
		}

		expect( errors ).toEqual( [] );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'publishes and pulls through Electron with inline options in both themes', async ( {
	browserName,
}, info ) => {
	expect( browserName ).toBe( 'chromium' );
	const session = await createSession();
	await mkdir( path.join( session.home, 'Publishing verification' ), { recursive: true } );
	await writeFile( path.join( session.home, 'Publishing verification', 'index.php' ), '' );
	await writeFile(
		path.join( session.config, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'publish-site',
					name: 'Publishing verification',
					path: path.join( session.home, 'Publishing verification' ),
					port: 8881,
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		} )
	);
	const { app, page, errors } = await launch( session );
	try {
		await page.waitForFunction( () =>
			Boolean( document.querySelector( '[data-sidebar-toggle]' ) )
		);
		await app.evaluate(
			( { ipcMain, BrowserWindow }, sitePath ) => {
				const state = globalThis as typeof globalThis & {
					publishTest: {
						connections: unknown[];
						calls: { direction: string; args: unknown[] }[];
						finish?: () => void;
						urls: string[];
					};
				};
				state.publishTest = { connections: [], calls: [], urls: [] };
				const site = {
					id: 'publish-site',
					name: 'Publishing verification',
					path: sitePath,
					port: 8881,
					phpVersion: '8.3',
					running: true,
				};
				const remote = {
					id: 42,
					localSiteId: site.id,
					name: 'Example website',
					url: 'https://example.wordpress.com',
					isStaging: false,
					isPressable: false,
					syncSupport: 'syncable',
					lastPushTimestamp: null,
					lastPullTimestamp: null,
				};
				const handlers: Record< string, ( ...args: unknown[] ) => unknown > = {
					getSiteDetails: () => [ site ],
					reconcileSites: () => [ site ],
					getAuthenticationToken: () => ( {
						id: 1,
						email: 'test@example.test',
						displayName: 'Publishing account',
						accessToken: 'test-only',
					} ),
					getConnectedWpcomSites: () => state.publishTest.connections,
					fetchSyncableWpcomSites: () => [ remote ],
					connectWpcomSites: () => {
						state.publishTest.connections = [ remote ];
					},
					listLocalFileTree: () => [
						{
							name: 'uploads',
							path: 'wp-content/uploads',
							isDirectory: true,
							children: [
								{ name: 'hero.jpg', path: 'wp-content/uploads/hero.jpg', isDirectory: false },
								{ name: 'cover.jpg', path: 'wp-content/uploads/cover.jpg', isDirectory: false },
							],
						},
						{ name: 'custom.css', path: 'wp-content/custom.css', isDirectory: false },
					],
					getDirectorySize: () => 0,
					getFileSize: () => 0,
					getWpVersion: () => '6.9',
					getHostingPhpVersion: () => '8.3',
					getIsMultisite: () => false,
					getLatestRewindId: () => 'backup-1',
					listRemoteFileTree: () => ( {} ),
					pushSiteToLive: ( ...args ) => {
						state.publishTest.calls.push( { direction: 'push', args } );
						return new Promise< void >( ( resolve ) => {
							state.publishTest.finish = resolve;
						} );
					},
					pullSiteFromLive: ( ...args ) => {
						state.publishTest.calls.push( { direction: 'pull', args } );
					},
					openExternal: ( url ) => {
						state.publishTest.urls.push( String( url ) );
					},
				};
				for ( const [ name, handler ] of Object.entries( handlers ) ) {
					ipcMain.removeHandler( name );
					ipcMain.handle( name, async ( _event, ...args ) => handler( ...args ) );
				}
				BrowserWindow.getAllWindows()[ 0 ].webContents.setZoomFactor( 1 );
			},
			path.join( session.home, 'Publishing verification' )
		);
		await page.reload();
		await page.getByRole( 'button', { name: 'Publishing verification', exact: true } ).click();
		const publishTrigger = page.getByRole( 'button', { name: 'Publish…', exact: true } );
		await publishTrigger.click();
		const setupPanel = page.getByRole( 'dialog', { name: 'Publish your WordPress', exact: true } );
		const setupButton = setupPanel.getByRole( 'button', {
			name: 'Publish on WordPress.com',
			exact: true,
		} );
		await expect( setupButton ).toBeEnabled();
		await setupPanel.evaluate( ( element ) =>
			Promise.all( element.getAnimations().map( ( animation ) => animation.finished ) )
		);
		const setupBounds = await setupPanel.boundingBox();
		const buttonBounds = await setupButton.boundingBox();
		const triggerBounds = await publishTrigger.boundingBox();
		await setupButton.click();
		const waitingButton = setupPanel.getByRole( 'button', {
			name: 'Waiting for WordPress.com…',
			exact: true,
		} );
		await expect( waitingButton ).toBeDisabled();
		await expect( waitingButton ).toHaveAttribute( 'data-variant', 'outline' );
		await expect.poll( () => setupPanel.boundingBox() ).toEqual( setupBounds );
		expect( await waitingButton.boundingBox() ).toEqual( buttonBounds );
		expect( await publishTrigger.boundingBox() ).toEqual( triggerBounds );
		await app.evaluate( ( { BrowserWindow } ) => {
			const contents = BrowserWindow.getAllWindows()[ 0 ].webContents;
			contents.send( 'sync-connect-site', {
				remoteSiteId: 42,
				studioSiteId: 'publish-site',
				autoOpenPush: true,
			} );
		} );
		await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeVisible();
		await expect
			.poll( () =>
				app.evaluate(
					() =>
						( globalThis as typeof globalThis & { publishTest: { calls: unknown[] } } ).publishTest
							.calls.length
				)
			)
			.toBe( 1 );
		await app.evaluate( () =>
			(
				globalThis as typeof globalThis & { publishTest: { finish: () => void } }
			 ).publishTest.finish()
		);
		await expect( page.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
		await page.keyboard.press( 'Escape' );
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( colorScheme ) => window.ipcApi.setUserPreferences( { colorScheme: colorScheme } ),
				scheme
			);
			await page.reload();
			await page.getByRole( 'button', { name: 'Publishing verification', exact: true } ).click();
			const openPublishMenu = async () => {
				if ( scheme === 'dark' )
					await page
						.getByRole( 'button', { name: 'Publishing verification', exact: true } )
						.click( { button: 'right' } );
				else
					await page
						.getByRole( 'button', {
							name: 'Site actions for Publishing verification',
							exact: true,
						} )
						.click();
				const publish = page.getByRole( 'menuitem', { name: 'Publish', exact: true } );
				await expect( publish ).toHaveAttribute( 'aria-haspopup', 'menu' );
				await publish.focus();
				await publish.press( 'ArrowRight' );
				await expect( page.getByRole( 'menuitem', { name: 'Publish changes…' } ) ).toBeVisible();
			};
			await openPublishMenu();
			await expect( page.getByRole( 'menuitem', { name: 'View backups' } ) ).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `desktop-publish-menu-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await page.getByRole( 'menuitem', { name: 'Manage websites…' } ).click();
			await expect( page.getByRole( 'dialog', { name: 'Websites', exact: true } ) ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await openPublishMenu();
			await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
			await expect(
				page
					.getByRole( 'dialog', { name: 'Pull changes', exact: true } )
					.getByRole( 'combobox', { name: 'What to pull' } )
			).toBeEnabled();
			await page.keyboard.press( 'Escape' );
			await openPublishMenu();
			await page.getByRole( 'menuitem', { name: 'Publish changes…' } ).click();
			const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
			await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
			await page.screenshot( {
				path: info.outputPath( `desktop-publish-${ scheme }.png` ),
				animations: 'disabled',
			} );
			const include = panel.getByRole( 'combobox', { name: 'What to publish' } );
			await include.focus();
			await include.press( 'ArrowDown' );
			await expect( page.getByRole( 'listbox' ) ).toBeVisible();
			await expect( async () => {
				await page.keyboard.press( 'End' );
				await expect( page.getByRole( 'option', { name: 'Choose files…' } ) ).toHaveAttribute(
					'data-highlighted',
					{ timeout: 500 }
				);
			} ).toPass();
			await page.keyboard.press( 'Enter' );
			const files = page.getByRole( 'dialog', { name: 'Choose files', exact: true } );
			await expect( files.getByRole( 'button', { name: 'Back to Publish' } ) ).toBeFocused();
			await files.getByRole( 'button', { name: 'Expand uploads' } ).click();
			await files.getByText( 'hero.jpg', { exact: true } ).click();
			await expect(
				files.getByRole( 'checkbox', { name: 'hero.jpg', exact: true } )
			).toBeChecked();
			await expect( files.getByRole( 'checkbox', { name: 'uploads', exact: true } ) ).toBeChecked( {
				indeterminate: true,
			} );
			const uploadBounds = await files
				.getByRole( 'checkbox', { name: 'uploads', exact: true } )
				.boundingBox();
			const fileBounds = await files
				.getByRole( 'checkbox', { name: 'custom.css', exact: true } )
				.boundingBox();
			expect( uploadBounds!.x ).toBe( fileBounds!.x );
			await page.screenshot( {
				path: info.outputPath( `desktop-publish-files-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await files.getByRole( 'button', { name: 'Done', exact: true } ).click();
			await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
			await page.getByRole( 'option', { name: 'Files only', exact: true } ).click();
			await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
			await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeVisible();
			await app.evaluate( ( { BrowserWindow } ) =>
				BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'sync-activity', {
					siteId: 'publish-site',
					activity: {
						kind: 'pending',
						direction: 'push',
						remoteSiteId: 42,
						phase: 'applyingChanges',
						message: 'Updating your website…',
						progress: 72,
					},
				} )
			);
			await expect( panel.getByText( 'Applying changes… (72%)' ) ).toBeVisible();
			await expect(
				panel.getByRole( 'progressbar', { name: 'Publishing progress' } )
			).toHaveJSProperty( 'ariaValueNow', '72' );
			await expect( panel.getByRole( 'button', { name: 'Cancel publishing' } ) ).toHaveCount( 0 );
			await page.emulateMedia( { reducedMotion: 'reduce' } );
			await expect
				.poll( () =>
					page
						.locator( '[data-publish-transfer] circle' )
						.first()
						.evaluate( ( element ) => getComputedStyle( element ).animationName )
				)
				.toBe( 'none' );
			await page.screenshot( {
				path: info.outputPath( `desktop-publishing-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await app.evaluate( () =>
				(
					globalThis as typeof globalThis & { publishTest: { finish: () => void } }
				 ).publishTest.finish()
			);
			await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
			await page.emulateMedia( { reducedMotion: 'no-preference' } );
			await panel.getByRole( 'button', { name: 'Website actions' } ).click();
			await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
			const pull = page.getByRole( 'dialog', { name: 'Pull changes', exact: true } );
			await expect( pull.getByRole( 'button', { name: 'Back to Publish' } ) ).toBeFocused();
			await expect( pull.getByRole( 'combobox', { name: 'What to pull' } ) ).toBeEnabled();
			await pull.getByRole( 'combobox', { name: 'What to pull' } ).click();
			await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
			await page.screenshot( {
				path: info.outputPath( `desktop-pull-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await pull.getByRole( 'button', { name: 'Pull changes', exact: true } ).click();
			await expect( pull.getByText( 'Changes pulled into WordPress Studio' ) ).toBeVisible();
			await pull.getByRole( 'button', { name: 'Done', exact: true } ).click();
			await expect( panel.getByRole( 'combobox', { name: 'What to publish' } ) ).toContainText(
				'Files only'
			);
			await page.keyboard.press( 'Escape' );
		}
		const calls = await app.evaluate(
			() =>
				(
					globalThis as typeof globalThis & {
						publishTest: { calls: { direction: string; args: unknown[] }[] };
					}
				 ).publishTest.calls
		);
		expect( calls.map( ( call ) => call.direction ) ).toEqual( [
			'push',
			'push',
			'pull',
			'push',
			'pull',
		] );
		expect( calls[ 1 ].args ).toEqual( [
			'publish-site',
			42,
			{ optionsToSync: [ 'plugins', 'themes', 'uploads', 'contents' ] },
		] );
		expect( calls[ 2 ].args ).toEqual( [ 'publish-site', 42, { optionsToSync: [ 'sqls' ] } ] );
		expect( errors ).toEqual( [] );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true } );
	}
} );
