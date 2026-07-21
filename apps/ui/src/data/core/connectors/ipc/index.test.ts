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
