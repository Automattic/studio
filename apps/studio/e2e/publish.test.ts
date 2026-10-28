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
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'shares a preview with the desktop screenshot, copies its link and opens checkout', async () => {
		const page = session.mainWindow;
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );
		const guestId = await page
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		const screenshot = await page.evaluate(
			( { siteId, guestId } ) => window.ipcApi.captureSitePreview( siteId, guestId, '/' ),
			{ siteId: site.id, guestId }
		);
		expect( screenshot ).toMatch( /^data:image\/png;base64,/ );

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
			ipcMain.removeHandler( 'getConnectedWpcomSites' );
			ipcMain.handle( 'getConnectedWpcomSites', () => [] );
			ipcMain.removeAllListeners( 'openURL' );
			ipcMain.on( 'openURL', ( _event, url: string ) => {
				captured.checkoutUrl = url;
			} );
		}, site.id );
		await page.reload();

		// The header folds Share into its More menu when the window is too narrow for it.
		const share = page.getByRole( 'button', { name: /^(Share|More preview actions)$/ } );
		const openShare = async () => {
			await share.click();
			if ( ( await share.getAttribute( 'aria-label' ) ) === 'More preview actions' ) {
				await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
			}
		};
		const dialog = page.getByRole( 'dialog', { name: 'Share', exact: true } );
		await openShare();
		await expect(
			dialog.getByRole( 'img', { name: 'Local site preview of Publishing verification' } )
		).toHaveAttribute( 'src', screenshot! );
		await expect( dialog.getByRole( 'textbox', { name: 'Preview link' } ) ).toHaveValue(
			'https://sharing-verification.wp.build'
		);
		await dialog.getByRole( 'button', { name: 'Copy link', exact: true } ).click();
		await expect( dialog.getByRole( 'button', { name: 'Copied', exact: true } ) ).toBeVisible();
		expect( await session.electronApp.evaluate( ( { clipboard } ) => clipboard.readText() ) ).toBe(
			'https://sharing-verification.wp.build'
		);

		await dialog.getByRole( 'button', { name: 'Choose a plan' } ).click();
		await expect( dialog ).toBeHidden();
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
				getConnectedWpcomSites: () => state.publishTest.connections,
				fetchSyncableWpcomSites: () => [ remote ],
				connectWpcomSites: () => {
					state.publishTest.connections = [ remote ];
				},
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
		}, site.id );
		const publishCalls = () =>
			session.electronApp.evaluate( () => ( globalThis as PublishState ).publishTest.calls );
		const finishPublish = () =>
			session.electronApp.evaluate( () => ( globalThis as PublishState ).publishTest.finish?.() );
		await page.reload();

		await page.getByRole( 'button', { name: 'Publish…', exact: true } ).click();
		const setupPanel = page.getByRole( 'dialog', { name: 'Publish your WordPress', exact: true } );
		await setupPanel
			.getByRole( 'button', { name: 'Publish on WordPress.com', exact: true } )
			.click();
		await expect(
			setupPanel.getByRole( 'button', { name: 'Waiting for WordPress.com…', exact: true } )
		).toBeDisabled();
		await session.electronApp.evaluate( ( { BrowserWindow }, studioSiteId ) => {
			BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'sync-connect-site', {
				remoteSiteId: 42,
				studioSiteId,
				autoOpenPush: true,
			} );
		}, site.id );
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 1 );
		await finishPublish();
		const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();

		await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
		await page.getByRole( 'option', { name: 'Files only', exact: true } ).click();
		await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
		await expect.poll( async () => ( await publishCalls() ).length ).toBe( 2 );
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
		await page.keyboard.press( 'Escape' );

		const calls = await publishCalls();
		expect( calls.map( ( call ) => call.direction ) ).toEqual( [ 'push', 'push', 'pull' ] );
		expect( calls[ 1 ].args ).toEqual( [
			site.id,
			42,
			{ optionsToSync: [ 'plugins', 'themes', 'uploads', 'contents' ] },
		] );
		expect( calls[ 2 ].args ).toEqual( [ site.id, 42, { optionsToSync: [ 'sqls' ] } ] );
	} );
} );
