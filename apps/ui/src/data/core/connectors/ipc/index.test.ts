import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './index';

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

describe( 'createIpcConnector Connect contracts', () => {
	const createSite = vi.fn();
	const getAllConnectedWpcomSites = vi.fn();
	const fetchAllWpcomSites = vi.fn();
	const getSiteDetails = vi.fn();
	const getConnectedWpcomSites = vi.fn();
	const pullSiteFromLive = vi.fn();
	const subscribe = vi.fn();
	const unsubscribe = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.stubGlobal( 'ipcApi', {
			createSite,
			getAllConnectedWpcomSites,
			fetchAllWpcomSites,
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
		getAllConnectedWpcomSites.mockResolvedValue( [ { id: 1 } ] );
		fetchAllWpcomSites.mockResolvedValue( [ { id: 2 } ] );
		const connector = createIpcConnector();

		await expect( connector.getAllConnectedWpcomSites() ).resolves.toEqual( [ { id: 1 } ] );
		await expect( connector.fetchAllWpcomSites() ).resolves.toEqual( [ { id: 2 } ] );

		expect( getAllConnectedWpcomSites ).toHaveBeenCalledOnce();
		expect( fetchAllWpcomSites ).toHaveBeenCalledOnce();
	} );

	it( 'forwards matching CLI pull progress and unsubscribes when the pull finishes', async () => {
		getSiteDetails.mockResolvedValue( [ { id: 'site-1', path: '/sites/site-1' } ] );
		getConnectedWpcomSites.mockResolvedValue( [] );
		let progressListener: ( event: unknown, payload: unknown ) => void = () => {};
		subscribe.mockImplementation( ( channel, listener ) => {
			expect( channel ).toBe( 'sync-pull-progress' );
			progressListener = listener;
			return unsubscribe;
		} );
		pullSiteFromLive.mockImplementation( async ( _path, _remoteSiteId, operationId ) => {
			progressListener( {}, { operationId: 'other', message: 'Ignore me' } );
			progressListener( {}, { operationId, message: 'Downloading backup… (50%)', progress: 50 } );
		} );
		const onProgress = vi.fn();

		await createIpcConnector().pullSiteFromLive( 'site-1', 42, onProgress );

		expect( pullSiteFromLive ).toHaveBeenCalledWith( '/sites/site-1', 42, expect.any( String ) );
		expect( onProgress ).toHaveBeenCalledOnce();
		expect( onProgress ).toHaveBeenCalledWith( {
			message: 'Downloading backup… (50%)',
			progress: 50,
		} );
		expect( unsubscribe ).toHaveBeenCalledOnce();
	} );
} );
