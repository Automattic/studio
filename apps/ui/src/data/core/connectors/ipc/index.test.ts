import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './index';
import type { SiteDetails } from '@/data/core';

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

	it( 'forwards matching CLI pull progress and unsubscribes when the pull finishes', async () => {
		getConnectedWpcomSites.mockResolvedValue( [] );
		let progressListener: ( event: unknown, payload: unknown ) => void = () => {};
		subscribe.mockImplementation( ( channel, listener ) => {
			expect( channel ).toBe( 'sync-pull-progress' );
			progressListener = listener;
			return unsubscribe;
		} );
		pullSiteFromLive.mockImplementation( async ( siteId ) => {
			progressListener( {}, { siteId: 'other', message: 'Ignore me' } );
			progressListener(
				{},
				{
					siteId,
					message: 'Downloading backup… (50%)',
					progress: 50,
					action: 'initiateBackup',
				}
			);
		} );
		const onProgress = vi.fn();

		await createIpcConnector().pullSiteFromLive( 'site-1', 42, onProgress );

		expect( pullSiteFromLive ).toHaveBeenCalledWith( 'site-1', 42, undefined );
		expect( onProgress ).toHaveBeenCalledOnce();
		expect( onProgress ).toHaveBeenCalledWith( {
			message: 'Downloading backup… (50%)',
			progress: 50,
			action: 'initiateBackup',
		} );
		expect( unsubscribe ).toHaveBeenCalledOnce();
	} );

	// A cancelled sync never happened, so it must not stamp the connection's
	// last-synced time — otherwise the site header would later read "Pushed 2
	// minutes ago" for a push the user stopped.
	it( 'does not record a sync time when the push is cancelled', async () => {
		getConnectedWpcomSites.mockResolvedValue( [
			{ id: 42, localSiteId: 'site-1', lastPushTimestamp: null },
		] );
		subscribe.mockImplementation( () => unsubscribe );
		pushSiteToLive.mockResolvedValue( { cancelled: true } );

		await expect( createIpcConnector().pushSiteToLive( 'site-1', 42 ) ).rejects.toSatisfy(
			isSyncCancelledError
		);

		expect( updateConnectedWpcomSites ).not.toHaveBeenCalled();
	} );

	it( 'records the sync time once the push completes', async () => {
		getConnectedWpcomSites.mockResolvedValue( [
			{ id: 42, localSiteId: 'site-1', lastPushTimestamp: null },
		] );
		subscribe.mockImplementation( () => unsubscribe );
		pushSiteToLive.mockResolvedValue( { cancelled: false } );

		await createIpcConnector().pushSiteToLive( 'site-1', 42 );

		expect( updateConnectedWpcomSites ).toHaveBeenCalledWith( [
			expect.objectContaining( { id: 42, lastPushTimestamp: expect.any( String ) } ),
		] );
	} );

	// The main process reports a user cancel as a result rather than rejecting, so
	// Electron doesn't log it as a handler error in the log we point users at when
	// a pull fails. The connector turns it back into an error for the caller.
	it( 'raises a reported cancel as a cancelled error', async () => {
		getConnectedWpcomSites.mockResolvedValue( [] );
		subscribe.mockImplementation( () => unsubscribe );
		pullSiteFromLive.mockResolvedValue( { cancelled: true } );

		await expect( createIpcConnector().pullSiteFromLive( 'site-1', 42 ) ).rejects.toSatisfy(
			isSyncCancelledError
		);
	} );

	it( 'completes normally when nothing was cancelled', async () => {
		getConnectedWpcomSites.mockResolvedValue( [] );
		subscribe.mockImplementation( () => unsubscribe );
		pullSiteFromLive.mockResolvedValue( { cancelled: false } );

		await expect( createIpcConnector().pullSiteFromLive( 'site-1', 42 ) ).resolves.toBeUndefined();
	} );

	// Without the CLI action the cancel gate can't tell the remote phases from
	// the local import, so every pull looks cancellable right through the import.
	it( 'forwards the CLI action that drives the cancel gate', async () => {
		getConnectedWpcomSites.mockResolvedValue( [] );
		let progressListener: ( event: unknown, payload: unknown ) => void = () => {};
		subscribe.mockImplementation( ( _channel, listener ) => {
			progressListener = listener;
			return unsubscribe;
		} );
		pullSiteFromLive.mockImplementation( async ( siteId ) => {
			progressListener(
				{},
				{ siteId, message: 'Importing plugins… (3406/9394)', action: 'import' }
			);
		} );
		const onProgress = vi.fn();

		await createIpcConnector().pullSiteFromLive( 'site-1', 42, onProgress );

		expect( onProgress ).toHaveBeenCalledWith( {
			message: 'Importing plugins… (3406/9394)',
			action: 'import',
		} );
	} );
} );
