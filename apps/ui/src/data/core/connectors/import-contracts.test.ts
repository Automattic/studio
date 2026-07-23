import { ImporterEvents } from '@studio/common/lib/import-export-events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIpcConnector } from './ipc';
import { createLocalConnector } from './local';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';

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

	it( 'forwards Electron import progress for the active site and unsubscribes', async () => {
		let importListener:
			| ( ( event: unknown, importEvent: ImportEventTuple, siteId: string ) => void )
			| undefined;
		const unsubscribe = vi.fn();
		const subscribe = vi.fn(
			(
				_channel: string,
				listener: ( event: unknown, importEvent: ImportEventTuple, siteId: string ) => void
			) => {
				importListener = listener;
				return unsubscribe;
			}
		);
		let completeImport: () => void = () => undefined;
		const importSite = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					completeImport = () => resolve();
				} )
		);
		Object.assign( window, {
			ipcApi: { importSite },
			ipcListener: { subscribe },
		} );
		const connector = createIpcConnector();
		const onProgress = vi.fn();

		const importPromise = connector.importSiteFromBackup( 'site-1', '/tmp/backup.zip', onProgress );
		importListener?.( {}, [ ImporterEvents.IMPORT_DATABASE_START, null ], 'site-2' );
		importListener?.( {}, [ ImporterEvents.IMPORT_DATABASE_START, null ], 'site-1' );

		expect( subscribe ).toHaveBeenCalledWith( 'on-import', expect.any( Function ) );
		expect( onProgress ).toHaveBeenCalledOnce();
		expect( onProgress ).toHaveBeenCalledWith( [ ImporterEvents.IMPORT_DATABASE_START, null ] );

		completeImport();
		await importPromise;
		expect( unsubscribe ).toHaveBeenCalledOnce();
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

	it( 'forwards local-web import progress for the active site', async () => {
		class MockEventSource {
			static instance: MockEventSource;
			onmessage: ( ( event: MessageEvent ) => void ) | null = null;

			constructor( readonly url: string ) {
				MockEventSource.instance = this;
			}

			close() {}
		}
		vi.stubGlobal( 'EventSource', MockEventSource );
		let completeImport: () => void = () => undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise< Response >( ( resolve ) => {
						completeImport = () => resolve( new Response( null, { status: 204 } ) );
					} )
			)
		);
		const connector = createLocalConnector( { apiBaseUrl: 'http://localhost:8081' } );
		await connector.init?.();
		const onProgress = vi.fn();

		const importPromise = connector.importSiteFromBackup( 'site-1', '/tmp/backup.zip', onProgress );
		MockEventSource.instance.onmessage?.(
			new MessageEvent( 'message', {
				data: JSON.stringify( {
					channel: 'import',
					payload: {
						siteId: 'site-2',
						event: [ ImporterEvents.IMPORT_DATABASE_START, null ],
					},
				} ),
			} )
		);
		MockEventSource.instance.onmessage?.(
			new MessageEvent( 'message', {
				data: JSON.stringify( {
					channel: 'import',
					payload: {
						siteId: 'site-1',
						event: [ ImporterEvents.IMPORT_DATABASE_START, null ],
					},
				} ),
			} )
		);

		expect( onProgress ).toHaveBeenCalledOnce();
		expect( onProgress ).toHaveBeenCalledWith( [ ImporterEvents.IMPORT_DATABASE_START, null ] );

		completeImport();
		await importPromise;
		MockEventSource.instance.onmessage?.(
			new MessageEvent( 'message', {
				data: JSON.stringify( {
					channel: 'import',
					payload: {
						siteId: 'site-1',
						event: [ ImporterEvents.IMPORT_DATABASE_START, null ],
					},
				} ),
			} )
		);
		expect( onProgress ).toHaveBeenCalledOnce();
	} );
} );
