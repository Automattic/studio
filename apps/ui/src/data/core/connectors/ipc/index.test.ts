import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './index';
import type { SiteDetails } from '@/data/core';

describe( 'createIpcConnector window sizing', () => {
	const ensureMinWindowWidth = vi.fn().mockResolvedValue( 640 );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', { ensureMinWindowWidth } );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'asks the main process to grow the desktop window', async () => {
		const result = await createIpcConnector().ensureWindowWidth( 640 );

		expect( ensureMinWindowWidth ).toHaveBeenCalledWith( 640 );
		expect( result ).toBe( 640 );
	} );
} );

// Guards the renderer ↔ main IPC call shape: `exportSite` must be invoked as
// ( siteId, destinationPath, options ) to match the main-process handler in
// apps/studio/src/modules/import-export/lib/ipc-handlers.ts.
describe( 'createIpcConnector exports', () => {
	const exportSite = vi.fn().mockResolvedValue( undefined );
	const showSaveAsDialog = vi.fn();
	const getSiteDetails = vi
		.fn()
		.mockResolvedValue( [ { id: 'site-1', name: 'Demo Site', phpVersion: '8.4' } ] );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', { exportSite, showSaveAsDialog, getSiteDetails } );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'exports the full site through the main-process handler signature', async () => {
		showSaveAsDialog.mockResolvedValue( '/tmp/demo-backup.zip' );

		const result = await createIpcConnector().exportFullSite( 'site-1' );

		expect( exportSite ).toHaveBeenCalledWith( 'site-1', '/tmp/demo-backup.zip', {
			mode: 'full',
			showItemInFolder: true,
			showNotification: true,
		} );
		expect( result ).toBe( '/tmp/demo-backup.zip' );
	} );

	it( 'exports the database with the db mode', async () => {
		showSaveAsDialog.mockResolvedValue( '/tmp/demo-backup.sql' );

		const result = await createIpcConnector().exportDatabase( 'site-1' );

		expect( exportSite ).toHaveBeenCalledWith( 'site-1', '/tmp/demo-backup.sql', {
			mode: 'db',
			showItemInFolder: true,
			showNotification: true,
		} );
		expect( result ).toBe( '/tmp/demo-backup.sql' );
	} );

	it( 'skips the export when the save dialog is cancelled', async () => {
		showSaveAsDialog.mockResolvedValue( undefined );

		const result = await createIpcConnector().exportFullSite( 'site-1' );

		expect( exportSite ).not.toHaveBeenCalled();
		expect( result ).toBeNull();
	} );
} );

describe( 'createIpcConnector openSiteInEditor', () => {
	const getSiteDetails = vi
		.fn()
		.mockResolvedValue( [ { id: 'site-1', name: 'Demo', path: '/Users/x/Studio/demo' } ] );
	const getUserEditor = vi.fn().mockResolvedValue( 'vscode' );
	const openAppAtPath = vi.fn();
	const recordAnalyticsEvent = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', {
			getSiteDetails,
			getUserEditor,
			openAppAtPath,
			recordAnalyticsEvent,
		} );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'records an open-in-editor event and launches the editor at the site path', async () => {
		await createIpcConnector().openSiteInEditor( 'site-1' );

		expect( recordAnalyticsEvent ).toHaveBeenCalledWith( 'studio_site_open_in_editor', {
			editor: 'vscode',
		} );
		expect( openAppAtPath ).toHaveBeenCalledWith( 'vscode', '/Users/x/Studio/demo' );
	} );

	it( 'does not record or launch when no editor is configured', async () => {
		getUserEditor.mockResolvedValueOnce( null );

		await expect( createIpcConnector().openSiteInEditor( 'site-1' ) ).rejects.toThrow();

		expect( recordAnalyticsEvent ).not.toHaveBeenCalled();
		expect( openAppAtPath ).not.toHaveBeenCalled();
	} );
} );

describe( 'createIpcConnector Connect contracts', () => {
	const createSite = vi.fn();
	const fetchSyncableWpcomSites = vi.fn();
	const generateNumberedNameFromList = vi.fn();
	const getSiteDetails = vi.fn();
	const getConnectedWpcomSites = vi.fn();
	const pullSiteFromLive = vi.fn();
	const pushSiteToLive = vi.fn();
	const updateConnectedWpcomSites = vi.fn();
	const subscribe = vi.fn();
	const unsubscribe = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', {
			createSite,
			fetchSyncableWpcomSites,
			generateNumberedNameFromList,
			getSiteDetails,
			getConnectedWpcomSites,
			pullSiteFromLive,
			pushSiteToLive,
			updateConnectedWpcomSites,
		} );
		vi.stubGlobal( 'ipcListener', { subscribe } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'creates the local shell without starting it', async () => {
		createSite.mockResolvedValue( { id: 'site-1' } );

		await createIpcConnector().createSite( {
			name: 'Remote site',
			path: '/sites/remote-site',
			skipStart: true,
		} );

		expect( createSite ).toHaveBeenCalledWith(
			'/sites/remote-site',
			expect.objectContaining( { siteName: 'Remote site', noStart: true } )
		);
	} );

	it( 'uses explicit IPC calls for all remote sites and all local connections', async () => {
		getConnectedWpcomSites.mockResolvedValue( [ { id: 1 } ] );
		fetchSyncableWpcomSites.mockResolvedValue( [ { id: 2 } ] );
		const connector = createIpcConnector();

		await expect( connector.getConnectedWpcomSites() ).resolves.toEqual( [ { id: 1 } ] );
		await expect( connector.fetchSyncableWpcomSites() ).resolves.toEqual( [ { id: 2 } ] );

		expect( getConnectedWpcomSites ).toHaveBeenCalledWith( undefined );
		expect( fetchSyncableWpcomSites ).toHaveBeenCalledWith();
	} );

	it( 'generates a numbered name in one IPC call', async () => {
		generateNumberedNameFromList.mockReturnValue( 'Remote Site 3' );
		const sites = [
			{ id: '1', name: 'Remote Site' },
			{ id: '2', name: 'Remote Site 2' },
		] as SiteDetails[];

		await expect(
			createIpcConnector().generateNumberedSiteName( 'Remote Site', sites )
		).resolves.toBe( 'Remote Site 3' );

		expect( generateNumberedNameFromList ).toHaveBeenCalledWith( 'Remote Site', sites );
	} );

	// The main process reports a user cancel as a result rather than rejecting, so
	// Electron doesn't log it as a handler error in the log we point users at when
	// a sync fails. The connector turns it back into an error for the caller.
	it.each( [ 'pullSiteFromLive', 'pushSiteToLive' ] as const )(
		'raises a cancel reported by %s as a cancelled error',
		async ( method ) => {
			( method === 'pullSiteFromLive' ? pullSiteFromLive : pushSiteToLive ).mockResolvedValue( {
				cancelled: true,
			} );

			await expect( createIpcConnector()[ method ]( 'site-1', 42 ) ).rejects.toSatisfy(
				isSyncCancelledError
			);
		}
	);

	it( 'completes normally when nothing was cancelled', async () => {
		pullSiteFromLive.mockResolvedValue( { cancelled: false } );

		await expect( createIpcConnector().pullSiteFromLive( 'site-1', 42 ) ).resolves.toBeUndefined();
		expect( pullSiteFromLive ).toHaveBeenCalledWith( 'site-1', 42, undefined );
	} );

	it( 'relays the sync activity the CLI publishes', () => {
		const listener = vi.fn();
		subscribe.mockImplementation( ( channel, relay ) => {
			expect( channel ).toBe( 'sync-activity' );
			relay( {}, { siteId: 'site-1', activity: { kind: 'success', direction: 'push' } } );
			return unsubscribe;
		} );

		createIpcConnector().onSyncActivity( listener );

		expect( listener ).toHaveBeenCalledWith( {
			siteId: 'site-1',
			activity: { kind: 'success', direction: 'push' },
		} );
	} );
} );

// `window.ipcApi` is untyped, so only a test catches a drifting method name or
// argument order here. The relative path is shared with the local server.
describe( 'createIpcConnector debug log', () => {
	const getAbsolutePathFromSite = vi.fn();
	const openLocalPath = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', { getAbsolutePathFromSite, openLocalPath } );
		vi.stubGlobal( 'ipcListener', { subscribe: vi.fn() } );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'resolves the log through main, then opens what it resolved', async () => {
		getAbsolutePathFromSite.mockResolvedValue( '/sites/demo/wp-content/debug.log' );

		await expect( createIpcConnector().siteDebugLogExists( 'site-1' ) ).resolves.toBe( true );
		expect( getAbsolutePathFromSite ).toHaveBeenCalledWith( 'site-1', 'wp-content/debug.log' );

		await createIpcConnector().openSiteDebugLog( 'site-1' );
		expect( openLocalPath ).toHaveBeenCalledWith( '/sites/demo/wp-content/debug.log' );
	} );

	it( 'reports no log, and opens nothing, when main resolves null', async () => {
		getAbsolutePathFromSite.mockResolvedValue( null );

		await expect( createIpcConnector().siteDebugLogExists( 'site-1' ) ).resolves.toBe( false );
		await expect( createIpcConnector().openSiteDebugLog( 'site-1' ) ).rejects.toThrow();
		expect( openLocalPath ).not.toHaveBeenCalled();
	} );
} );
