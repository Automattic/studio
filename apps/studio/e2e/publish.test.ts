import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { E2ESession, launchWithSite } from './e2e-helpers';
import type { PersistedSite } from './e2e-helpers';

type PublishCall = { direction: string; args: unknown[] };
type PublishState = typeof globalThis & {
	publishTest: { connections: unknown[]; calls: PublishCall[]; finish?: () => void };
};

// WordPress.com is replaced by IPC handler stubs; the local site, its preview and the main process
// are real.
test.describe( 'Share and publish', () => {
	const session = new E2ESession();
	let site: PersistedSite;

	test.beforeAll( async () => {
		( { site } = await launchWithSite( session, { siteName: 'Publishing verification' } ) );
		await mkdir( path.join( site.path, 'wp-content', 'uploads' ), { recursive: true } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'copies a preview link and opens checkout from Share', async () => {
		const page = session.mainWindow;
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );

		await session.electronApp.evaluate( ( { ipcMain }, siteId ) => {
			const captured = globalThis as typeof globalThis & { checkoutUrl?: string };
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
			ipcMain.removeHandler( 'getPreviewStatus' );
			ipcMain.handle( 'getPreviewStatus', () => ( {
				localChanged: false,
				previewChanged: false,
			} ) );
			ipcMain.removeHandler( 'getRemoteSites' );
			ipcMain.handle( 'getRemoteSites', () => [] );
			ipcMain.removeAllListeners( 'openURL' );
			ipcMain.on( 'openURL', ( _event, url: string ) => {
				captured.checkoutUrl = url;
			} );
		}, site.id );
		await page.reload();

		await page.getByRole( 'button', { name: 'Share…', exact: true } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Share', exact: true } );
		await expect(
			dialog.getByRole( 'button', {
				name: 'Open preview: Client review',
				exact: true,
			} )
		).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Copy link', exact: true } ).click();
		await expect
			.poll( () => session.electronApp.evaluate( ( { clipboard } ) => clipboard.readText() ) )
			.toBe( 'https://sharing-verification.wp.build' );

		await dialog.getByRole( 'button', { name: 'Make it public', exact: true } ).click();
		await expect( dialog ).toBeVisible();
		const checkoutUrl = () =>
			session.electronApp.evaluate(
				() => ( globalThis as typeof globalThis & { checkoutUrl?: string } ).checkoutUrl
			);
		await expect.poll( checkoutUrl ).toBeTruthy();
		const checkout = new URL( ( await checkoutUrl() )! );
		expect( checkout.origin + checkout.pathname ).toBe(
			'https://wordpress.com/setup/new-hosted-site'
		);
		expect( checkout.searchParams.get( 'studioSiteId' ) ).toBe( site.id );
		await page.keyboard.press( 'Escape' );
	} );

	test( 'connects a WordPress.com site, then publishes and pulls through the main process', async () => {
		const page = session.mainWindow;
		await session.electronApp.evaluate( ( { ipcMain }, siteId ) => {
			const state = globalThis as PublishState;
			state.publishTest = { connections: [], calls: [] };
			const remote = {
				id: 42,
				localSiteId: siteId,
				name: 'Example website',
				url: 'https://example.wordpress.com',
				isStaging: false,
				isPressable: false,
				syncSupport: 'syncable',
				lastPushTimestamp: null as string | null,
				lastPullTimestamp: null,
			};
			const handlers: Record< string, ( ...args: unknown[] ) => unknown > = {
				getAuthenticationToken: () => ( {
					id: 1,
					email: 'test@example.test',
					displayName: 'Publishing account',
					accessToken: 'test-only',
				} ),
				getRemoteSites: ( provider ) =>
					provider === 'wpcom' ? state.publishTest.connections : [],
				listAccountSites: ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
				connectRemoteSite: () => {
					state.publishTest.connections = [ remote ];
				},
				getSitePublishStatus: () => ( { localChanged: true } ),
				getIsMultisite: () => false,
				getRemoteBackupId: () => 'backup-1',
				listRemoteBackupFiles: () => ( {} ),
				pushSite: ( ...args ) => {
					state.publishTest.calls.push( { direction: 'push', args } );
					return new Promise< void >( ( resolve ) => {
						state.publishTest.finish = () => {
							remote.lastPushTimestamp = new Date().toISOString();
							resolve();
						};
					} );
				},
				pullSite: ( ...args ) => {
					state.publishTest.calls.push( { direction: 'pull', args } );
				},
				openExternal: () => {},
			};
			for ( const [ name, handler ] of Object.entries( handlers ) ) {
				ipcMain.removeHandler( name );
				ipcMain.handle( name, async ( _event, ...args ) => handler( ...args ) );
			}
		}, site.id );
		const publishCalls = () =>
			session.electronApp.evaluate( () => ( globalThis as PublishState ).publishTest.calls );
		const finishPublish = () =>
			session.electronApp.evaluate( () => ( globalThis as PublishState ).publishTest.finish?.() );
		await page.reload();

		await page.getByRole( 'button', { name: 'Share…', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Make it public', exact: true } ).click();
		const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
		const mainWindow = await session.electronApp.browserWindow( page );
		await mainWindow.evaluate( ( window, studioSiteId ) => {
			window.webContents.send( 'sync-connect-site', {
				remoteSiteId: 42,
				studioSiteId,
				autoOpenPush: true,
			} );
		}, site.id );
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
		expect( await publishCalls() ).toHaveLength( 0 );
		await expect( panel.getByRole( 'button', { name: 'What to publish' } ) ).toBeVisible();
		await expect( page.getByRole( 'alertdialog' ) ).toHaveCount( 0 );
		await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 1 );
		await finishPublish();

		await panel.getByRole( 'button', { name: 'What to publish' } ).click();
		await page.getByRole( 'checkbox', { name: /^Database\b/ } ).uncheck();
		await page.keyboard.press( 'Escape' );
		await panel.getByRole( 'button', { name: 'Publish changes', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 2 );
		await finishPublish();
		await expect(
			panel.getByRole( 'button', { name: 'Publish changes', exact: true } )
		).toBeEnabled();

		await panel.getByRole( 'button', { name: 'More options', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Pull from live site', exact: true } ).click();
		const pull = page.getByRole( 'alertdialog', { name: 'Pull from live site?' } );
		await pull.getByRole( 'combobox', { name: 'What to pull' } ).click();
		await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
		await pull.getByRole( 'button', { name: 'Pull changes', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 3 );
		await expect( pull ).not.toBeVisible();
		await page.keyboard.press( 'Escape' );

		const calls = await publishCalls();
		expect( calls.map( ( call ) => call.direction ) ).toEqual( [ 'push', 'push', 'pull' ] );
		expect( calls[ 1 ].args ).toEqual( [
			'wpcom',
			site.id,
			42,
			{
				optionsToSync: [ 'plugins', 'themes', 'uploads' ],
				specificSelectionPaths: [ 'plugins', 'themes', 'uploads' ],
			},
		] );
		expect( calls[ 2 ].args ).toEqual( [ 'wpcom', site.id, 42, { optionsToSync: [ 'sqls' ] } ] );
	} );
} );
