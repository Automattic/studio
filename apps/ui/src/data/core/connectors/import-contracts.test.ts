import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './ipc';
import { createLocalConnector } from './local';

describe( 'import connector contracts', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'calls the Electron import IPC with positional arguments and starts the site', async () => {
		const importSite = vi.fn( async () => undefined );
		Object.assign( window, {
			ipcApi: { importSite },
			ipcListener: {},
		} );
		const connector = createIpcConnector();

		await connector.importSiteFromBackup( 'site-1', '/tmp/backup.sql' );

		expect( importSite ).toHaveBeenCalledWith( 'site-1', '/tmp/backup.sql', {
			alwaysStartServer: true,
			showErrorModal: false,
			showNotification: false,
		} );
	} );

	it( 'uploads a File to a unique path for every local-web resolution', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response( JSON.stringify( { path: '/tmp/studio-upload-one/backup.sql' } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} )
			)
			.mockResolvedValueOnce(
				new Response( JSON.stringify( { path: '/tmp/studio-upload-two/backup.sql' } ), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				} )
			)
			.mockResolvedValueOnce( new Response( null, { status: 204 } ) );
		vi.stubGlobal( 'fetch', fetch );
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );
		const file = new File( [ 'backup' ], 'backup.sql', { type: 'application/sql' } );

		const firstPath = await connector.getFilePath( file );
		const secondPath = await connector.getFilePath( file );
		await connector.importSiteFromBackup( 'site/1', secondPath );

		expect( firstPath ).toBe( '/tmp/studio-upload-one/backup.sql' );
		expect( secondPath ).toBe( '/tmp/studio-upload-two/backup.sql' );
		expect( firstPath ).not.toBe( secondPath );
		expect( fetch ).toHaveBeenNthCalledWith(
			3,
			'http://localhost:8081/api/sites/site%2F1/import',
			expect.objectContaining( {
				method: 'POST',
				body: JSON.stringify( { path: secondPath } ),
			} )
		);
	} );
} );
