import { test, expect } from '@playwright/test';
import { E2ESession } from './e2e-helpers';

// Most of the IPC contract is already guaranteed at compile time: `window.ipcApi`
// is typed as `IpcApi`, a mapped type derived from every export of `ipc-handlers.ts`
// (see `src/ipc-types.d.ts`), so renames, signature drift, void/invoke mismatches and
// missing preload wiring all fail `npm run typecheck`. What the compiler cannot prove
// is that the Electron runtime wiring actually round-trips: contextBridge exposure,
// `ipcRenderer.invoke` -> `ipcMain.handle`, sender validation, and argument/return
// serialization across the process boundary. These few tests cover exactly that gap,
// without re-testing business logic (which now lives in CLI tests).
test.describe( 'IPC bridge', () => {
	const session = new E2ESession();

	test.beforeAll( async () => {
		await session.launch();
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'exposes ipcApi and ipcListener on the renderer via contextBridge', async () => {
		const exposed = await session.mainWindow.evaluate( () => ( {
			// A spread of representative handlers: core, auth, a site invoke handler,
			// a re-exported module handler, and a send-style (void) handler.
			getAppGlobals: typeof window.ipcApi?.getAppGlobals,
			isAuthenticated: typeof window.ipcApi?.isAuthenticated,
			startServer: typeof window.ipcApi?.startServer,
			createSnapshot: typeof window.ipcApi?.createSnapshot,
			openURL: typeof window.ipcApi?.openURL,
			subscribe: typeof window.ipcListener?.subscribe,
		} ) );

		expect( exposed ).toEqual( {
			getAppGlobals: 'function',
			isAuthenticated: 'function',
			startServer: 'function',
			createSnapshot: 'function',
			openURL: 'function',
			subscribe: 'function',
		} );
	} );

	test( 'invoke handler round-trips a primitive (isAuthenticated)', async () => {
		const result = await session.mainWindow.evaluate( () => window.ipcApi.isAuthenticated() );

		// Asserting the shape, not the auth state: this verifies the invoke/handle
		// round-trip and sender validation, not whatever the isolated env's auth happens to be.
		expect( typeof result ).toBe( 'boolean' );
	} );

	test( 'invoke handler round-trips a structured object with real main data (getAppGlobals)', async () => {
		const globals = await session.mainWindow.evaluate( () => window.ipcApi.getAppGlobals() );

		// `platform` is produced in the main process from `process.platform`. Matching it here
		// proves a real handler executed and a structured object serialized back across IPC.
		expect( globals.platform ).toBe( process.platform );
		expect( typeof globals.appVersion ).toBe( 'string' );
		expect( globals.appVersion.length ).toBeGreaterThan( 0 );
	} );
} );
