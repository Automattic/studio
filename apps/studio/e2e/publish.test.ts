import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';
import type { ProviderSites } from '@studio/providers';

type SyncSite = ProviderSites[ 'wpcom' ];
type PublishCall = { direction: string; args: unknown[] };
type PublishState = typeof globalThis & {
	publishTest: { connections: SyncSite[]; calls: PublishCall[]; finish?: () => void };
};

// These cases exercise Publish and the IPC boundary with provider operations stubbed.
test.describe( 'Publish', () => {
	const session = new E2ESession();
	const site = {
		id: randomUUID(),
		name: 'Publishing verification',
		path: path.join( session.homePath, 'Studio', 'publishing-verification' ),
		port: 8881,
		url: 'http://localhost:8881',
		phpVersion: '8.4',
	};

	test.beforeAll( async () => {
		await Promise.all(
			[ 'database', 'plugins', 'themes', 'uploads' ].map( ( directory ) =>
				mkdir( path.join( site.path, 'wp-content', directory ), { recursive: true } )
			)
		);
		await session.launch( {}, { appData: { sites: [ site ] } } );
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'copies a preview link and opens its checkout', async () => {
		const page = session.mainWindow;
		await session.electronApp.evaluate( ( { ipcMain }, siteId ) => {
			const captured = globalThis as typeof globalThis & {
				checkoutUrl?: string;
				copiedText?: string;
			};
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
					url: 'sharing-verification.wpcomstaging.com',
					shareUrl: 'https://sharing-verification.wpcomstaging.com/?share=demo',
					launchUrl: 'https://wordpress.com/setup/launch-site?siteId=9001',
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
			ipcMain.removeHandler( 'copyText' );
			ipcMain.handle( 'copyText', ( _event, text: string ) => {
				captured.copiedText = text;
			} );
			ipcMain.removeAllListeners( 'openURL' );
			ipcMain.on( 'openURL', ( _event, url: string ) => {
				captured.checkoutUrl = url;
			} );
		}, site.id );
		await page.reload();

		await page.getByRole( 'button', { name: 'Publish…', exact: true } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Preview details', exact: true } );
		await expect(
			dialog.getByRole( 'group', {
				name: 'Preview: Client review',
				exact: true,
			} )
		).toBeVisible();
		await expect( dialog.getByRole( 'button', { name: 'Previews', exact: true } ) ).toHaveCount(
			0
		);
		const previewRow = dialog.getByRole( 'group', { name: 'Preview: Client review', exact: true } );
		await previewRow.getByRole( 'button', { name: 'Preview actions', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Copy link', exact: true } ).click();
		await expect
			.poll( () =>
				session.electronApp.evaluate(
					() => ( globalThis as typeof globalThis & { copiedText?: string } ).copiedText
				)
			)
			.toBe( 'https://sharing-verification.wpcomstaging.com/?share=demo' );

		const access = dialog.getByRole( 'combobox', { name: 'Who can view', exact: true } );
		await access.click();
		await expect(
			page.getByRole( 'option', { name: 'Anyone with the link', selected: true } )
		).toBeVisible();
		await page.getByRole( 'option', { name: 'Everyone', exact: true } ).click();
		await dialog.getByRole( 'button', { name: 'Continue on WordPress.com', exact: true } ).click();
		await expect( dialog ).toBeVisible();
		const checkoutUrl = () =>
			session.electronApp.evaluate(
				() => ( globalThis as typeof globalThis & { checkoutUrl?: string } ).checkoutUrl
			);
		await expect.poll( checkoutUrl ).toBeTruthy();
		const checkout = new URL( ( await checkoutUrl() )! );
		expect( checkout.origin + checkout.pathname ).toBe( 'https://wordpress.com/setup/launch-site' );
		expect( checkout.searchParams.get( 'siteId' ) ).toBe( '9001' );
		await page.keyboard.press( 'Escape' );
	} );

	test( 'connects a WordPress.com site, then publishes and pulls through the main process', async () => {
		const page = session.mainWindow;
		await session.electronApp.evaluate( ( { ipcMain }, siteId ) => {
			const state = globalThis as PublishState;
			state.publishTest = { connections: [], calls: [] };
			const remote: SyncSite = {
				id: 42,
				localSiteId: siteId,
				name: 'Example website',
				url: 'https://example.wordpress.com',
				isStaging: false,
				isPressable: false,
				syncSupport: 'syncable',
				launchStatus: 'unlaunched',
				lastPushTimestamp: null,
				lastPullTimestamp: null,
			};
			const handlers: Record< string, ( ...args: unknown[] ) => unknown > = {
				getAuthenticationToken: () => ( {
					id: 1,
					email: 'test@example.test',
					displayName: 'Publishing account',
					accessToken: 'test-only',
				} ),
				fetchSnapshots: () => [],
				getRemoteSites: ( provider ) =>
					provider === 'wpcom' ? state.publishTest.connections : [],
				listAccountSites: ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
				connectRemoteSite: ( _provider, _localSiteId, connection ) => {
					state.publishTest.connections = [ connection as SyncSite ];
				},
				getSitePublishStatus: () => ( { localChanged: true } ),
				getIsMultisite: () => false,
				getRemoteBackupId: () => 'backup-1',
				listRemoteBackupFiles: () => ( {} ),
				pushSite: ( ...args ) => {
					state.publishTest.calls.push( { direction: 'push', args } );
					return new Promise< void >( ( resolve ) => {
						state.publishTest.finish = () => {
							const publishedAt = new Date().toISOString();
							remote.launchStatus = 'launched';
							state.publishTest.connections[ 0 ].lastPushTimestamp = publishedAt;
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
		await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeVisible();

		const mainWindow = await session.electronApp.browserWindow( page );
		await mainWindow.evaluate( ( window, studioSiteId ) => {
			window.webContents.send( 'sync-connect-site', {
				remoteSiteId: 42,
				studioSiteId,
				autoOpenPush: true,
			} );
		}, site.id );
		await expect
			.poll( () =>
				session.electronApp.evaluate(
					() => ( globalThis as PublishState ).publishTest.connections.length
				)
			)
			.toBe( 1 );
		await page.getByRole( 'button', { name: 'Publish…', exact: true } ).click();
		const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
		await expect( panel.getByRole( 'button', { name: 'Update', exact: true } ) ).toBeEnabled();
		expect( await publishCalls() ).toHaveLength( 0 );
		await expect( panel.getByRole( 'button', { name: 'What to publish' } ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'alertdialog' ) ).toHaveCount( 0 );
		await panel.getByRole( 'button', { name: 'Update', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 1 );
		await finishPublish();

		await panel.getByRole( 'button', { name: 'Update…', exact: true } ).click();
		const confirmation = page.getByRole( 'alertdialog', { name: 'Publish changes?' } );
		await confirmation.getByRole( 'button', { name: 'What to publish' } ).click();
		const database = page.getByRole( 'checkbox', { name: /^Database\b/ } );
		await expect( database ).toBeChecked();
		await database.click();
		await expect( database ).not.toBeChecked();
		await page.keyboard.press( 'Escape' );
		await expect( confirmation ).toContainText( 'example.wordpress.com' );
		expect( await publishCalls() ).toHaveLength( 1 );
		await confirmation.getByRole( 'button', { name: 'Publish changes', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 2 );
		await finishPublish();
		await expect( panel.getByRole( 'button', { name: 'Update…', exact: true } ) ).toBeEnabled();

		await panel.getByRole( 'button', { name: 'Pull from live site…', exact: true } ).click();
		const pull = page.getByRole( 'alertdialog', {
			name: 'Update local site from example.wordpress.com?',
		} );
		await pull.getByRole( 'combobox', { name: 'What to replace' } ).click();
		await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
		await pull.getByRole( 'button', { name: 'Replace selected content', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 3 );
		await expect( pull ).not.toBeVisible();
		await page.keyboard.press( 'Escape' );

		const calls = await publishCalls();
		expect( calls.map( ( call ) => call.direction ) ).toEqual( [ 'push', 'push', 'pull' ] );
		expect( calls[ 0 ].args ).toEqual( [ 'wpcom', site.id, 42, { optionsToSync: [ 'all' ] } ] );
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
