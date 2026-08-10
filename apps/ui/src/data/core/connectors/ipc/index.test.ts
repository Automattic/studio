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
			progressListener( {}, { siteId, message: 'Downloading backup… (50%)', progress: 50 } );
		} );
		const onProgress = vi.fn();

		await createIpcConnector().pullSiteFromLive( 'site-1', 42, onProgress );

		expect( pullSiteFromLive ).toHaveBeenCalledWith( 'site-1', 42 );
		expect( onProgress ).toHaveBeenCalledOnce();
		expect( onProgress ).toHaveBeenCalledWith( {
			message: 'Downloading backup… (50%)',
			progress: 50,
		} );
		expect( unsubscribe ).toHaveBeenCalledOnce();
	} );
} );
