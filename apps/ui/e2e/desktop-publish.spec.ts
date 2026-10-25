import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, previewText } from './desktop-app';

test( 'preview sharing reuses the desktop screenshot and copies its link', async () => {
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
			const captured = globalThis as typeof globalThis & {
				sharingCheckoutUrl?: string;
				previewPublishHosts: string[];
			};
			captured.previewPublishHosts = [];
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
			ipcMain.removeHandler( 'publishPreviewSite' );
			ipcMain.handle( 'publishPreviewSite', async ( _event, _siteFolder, hostname ) => {
				captured.previewPublishHosts.push( hostname );
				return { url: 'https://sharing-verification.wp.build' };
			} );
			ipcMain.removeAllListeners( 'openURL' );
			ipcMain.on( 'openURL', ( _event, url: string ) => {
				captured.sharingCheckoutUrl = url;
			} );
		}, site.id );
		const publishedHosts = () =>
			app.evaluate(
				() =>
					( globalThis as typeof globalThis & { previewPublishHosts: string[] } )
						.previewPublishHosts
			);
		await page.reload();
		// The header folds Share into its More menu when the window is too narrow for it.
		const share = page.getByRole( 'button', { name: /^(Share|More preview actions)$/ } );
		const openShare = async () => {
			await share.click();
			if ( ( await share.getAttribute( 'aria-label' ) ) === 'More preview actions' )
				await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
		};
		const dialog = page.getByRole( 'dialog', { name: 'Share', exact: true } );
		await openShare();
		await expect(
			dialog.getByRole( 'img', { name: 'Local site preview of Sharing verification' } )
		).toHaveAttribute( 'src', screenshot! );
		await expect( dialog.getByRole( 'textbox', { name: 'Preview link' } ) ).toHaveValue(
			'https://sharing-verification.wp.build'
		);
		await dialog.getByRole( 'button', { name: 'Copy link', exact: true } ).click();
		await expect( dialog.getByRole( 'button', { name: 'Copied', exact: true } ) ).toBeVisible();
		expect( await app.evaluate( ( { clipboard } ) => clipboard.readText() ) ).toBe(
			'https://sharing-verification.wp.build'
		);
		await dialog.getByRole( 'button', { name: 'Preview actions' } ).click();
		await expect( page.getByRole( 'menuitem', { name: 'Delete preview' } ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		expect( await publishedHosts() ).toEqual( [] );
		await dialog.getByRole( 'button', { name: 'Update preview' } ).click();
		await expect.poll( publishedHosts ).toEqual( [ 'sharing-verification.wp.build' ] );
		await expect( dialog.getByRole( 'button', { name: /^(Copy link|Copied)$/ } ) ).toBeEnabled();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();

		await openShare();
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
		await page.reload();
		await openShare();
		await dialog.getByRole( 'button', { name: 'Create preview', exact: true } ).click();
		await expect(
			dialog.getByRole( 'button', { name: 'Publishing preview…', exact: true } )
		).toBeDisabled();
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( share ).toHaveAccessibleDescription( 'Publishing preview…' );
		await expect
			.poll( () =>
				app.evaluate( ( { ipcMain } ) => ipcMain.listenerCount( 'finish-preview-test' ) )
			)
			.toBe( 1 );
		await app.evaluate( ( { ipcMain } ) => ipcMain.emit( 'finish-preview-test' ) );
		await expect( share ).toHaveAccessibleDescription( 'Preview ready' );
		await expect(
			page.getByText( 'Sharing verification preview ready', { exact: true } ).first()
		).toBeVisible();
		await openShare();
		await expect( dialog.getByText( /^Expires / ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Copy link' } ).click();
		await expect( dialog.getByRole( 'button', { name: 'Copied' } ) ).toBeVisible();
		expect( await app.evaluate( ( { clipboard } ) => clipboard.readText() ) ).toBe(
			'https://new-sharing-verification.wp.build'
		);
		await page.keyboard.press( 'Escape' );
		await expect( dialog ).toBeHidden();
		await expect( share ).not.toHaveAttribute( 'aria-description' );
		expect( errors ).toEqual( [] );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'publishes and pulls through Electron', async () => {
	const session = await createSession();
	const sitePath = path.join( session.home, 'Publishing verification' );
	const port = await portFinder.getOpenPort();
	await mkdir( sitePath, { recursive: true } );
	await writeFile( path.join( sitePath, 'index.php' ), '' );
	await writeFile(
		path.join( session.config, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'publish-site',
					name: 'Publishing verification',
					path: sitePath,
					port,
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		} )
	);
	const { app, page, errors } = await launch( session );
	try {
		await expect(
			page.getByRole( 'button', { name: 'Publishing verification', exact: true } )
		).toBeVisible();
		await app.evaluate(
			( { ipcMain }, { sitePath, port } ) => {
				const state = globalThis as typeof globalThis & {
					publishTest: {
						connections: unknown[];
						calls: { direction: string; args: unknown[] }[];
						finish?: () => void;
					};
				};
				state.publishTest = { connections: [], calls: [] };
				const site = {
					id: 'publish-site',
					name: 'Publishing verification',
					path: sitePath,
					port,
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
					openExternal: () => {},
				};
				for ( const [ name, handler ] of Object.entries( handlers ) ) {
					ipcMain.removeHandler( name );
					ipcMain.handle( name, async ( _event, ...args ) => handler( ...args ) );
				}
			},
			{ sitePath, port }
		);
		const publishCalls = () =>
			app.evaluate(
				() =>
					(
						globalThis as typeof globalThis & {
							publishTest: { calls: { direction: string; args: unknown[] }[] };
						}
					 ).publishTest.calls
			);
		const finishPublish = () =>
			app.evaluate( () =>
				(
					globalThis as typeof globalThis & { publishTest: { finish: () => void } }
				 ).publishTest.finish()
			);
		await page.reload();
		await page.getByRole( 'button', { name: 'Publishing verification', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Publish…', exact: true } ).click();
		const setupPanel = page.getByRole( 'dialog', { name: 'Publish your WordPress', exact: true } );
		await setupPanel
			.getByRole( 'button', { name: 'Publish on WordPress.com', exact: true } )
			.click();
		await expect(
			setupPanel.getByRole( 'button', { name: 'Waiting for WordPress.com…', exact: true } )
		).toBeDisabled();
		await app.evaluate( ( { BrowserWindow } ) => {
			BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'sync-connect-site', {
				remoteSiteId: 42,
				studioSiteId: 'publish-site',
				autoOpenPush: true,
			} );
		} );
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 1 );
		await finishPublish();
		await expect( page.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
		await page.keyboard.press( 'Escape' );

		const openPublishMenu = async ( { contextMenu = false } = {} ) => {
			if ( contextMenu )
				await page
					.getByRole( 'button', { name: 'Publishing verification', exact: true } )
					.click( { button: 'right' } );
			else
				await page
					.getByRole( 'button', { name: 'Site actions for Publishing verification', exact: true } )
					.click();
			const publish = page.getByRole( 'menuitem', { name: 'Publish', exact: true } );
			await publish.focus();
			await publish.press( 'ArrowRight' );
			await expect( page.getByRole( 'menuitem', { name: 'Publish changes…' } ) ).toBeVisible();
		};
		await openPublishMenu( { contextMenu: true } );
		await page.getByRole( 'menuitem', { name: 'Manage websites…' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Websites', exact: true } ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'menu' ) ).toHaveCount( 0 );
		await openPublishMenu();
		await page.getByRole( 'menuitem', { name: 'Publish changes…' } ).click();
		const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();

		await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
		await page.getByRole( 'option', { name: 'Choose files…' } ).click();
		const files = page.getByRole( 'dialog', { name: 'Choose files', exact: true } );
		await files.getByRole( 'button', { name: 'Expand uploads' } ).click();
		await files.getByText( 'hero.jpg', { exact: true } ).click();
		await expect( files.getByRole( 'checkbox', { name: 'hero.jpg', exact: true } ) ).toBeChecked();
		await expect( files.getByRole( 'checkbox', { name: 'uploads', exact: true } ) ).toBeChecked( {
			indeterminate: true,
		} );
		await files.getByRole( 'button', { name: 'Done', exact: true } ).click();
		await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
		await page.getByRole( 'option', { name: 'Files only', exact: true } ).click();
		await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
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
		await finishPublish();
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();

		await panel.getByRole( 'button', { name: 'Website actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
		const pull = page.getByRole( 'dialog', { name: 'Pull changes', exact: true } );
		await pull.getByRole( 'combobox', { name: 'What to pull' } ).click();
		await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
		await pull.getByRole( 'button', { name: 'Pull changes', exact: true } ).click();
		await expect( pull.getByText( 'Changes pulled into WordPress Studio' ) ).toBeVisible();
		await pull.getByRole( 'button', { name: 'Done', exact: true } ).click();
		await expect( panel.getByRole( 'combobox', { name: 'What to publish' } ) ).toContainText(
			'Files only'
		);
		await page.keyboard.press( 'Escape' );

		const calls = await publishCalls();
		expect( calls.map( ( call ) => call.direction ) ).toEqual( [ 'push', 'push', 'pull' ] );
		expect( calls[ 1 ].args ).toEqual( [
			'publish-site',
			42,
			{ optionsToSync: [ 'plugins', 'themes', 'uploads', 'contents' ] },
		] );
		expect( calls[ 2 ].args ).toEqual( [ 'publish-site', 42, { optionsToSync: [ 'sqls' ] } ] );
		expect( errors ).toEqual( [] );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
