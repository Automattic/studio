/**
 * @vitest-environment node
 */
import { app, autoUpdater, dialog } from 'electron';
import { vi } from 'vitest';
import type { UserData } from 'src/storage/storage-types';

let userData: Partial< UserData > = {};

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn( async () => userData ),
	updateAppdata: vi.fn( async ( update: Partial< UserData > ) => {
		userData = { ...userData, ...update };
	} ),
} ) );

vi.mock( 'src/lib/macos-update-install', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/lib/macos-update-install') >() ),
	readBundleIdentifier: vi.fn( () => null ),
} ) );

vi.mock( 'src/ipc-utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/ipc-utils') >() ),
	sendIpcEventToRenderer: vi.fn().mockResolvedValue( undefined ),
} ) );

vi.mock( 'src/main-window', () => ( { getExistingMainWindow: vi.fn() } ) );

const originalPlatform = process.platform;

async function loadPackagedUpdater() {
	vi.resetModules();
	vi.stubEnv( 'NODE_ENV', 'production' );
	( app as unknown as { isPackaged: boolean } ).isPackaged = true;
	( app as unknown as { whenReady: () => Promise< void > } ).whenReady = vi
		.fn()
		.mockResolvedValue( undefined );
	return import( 'src/updates' );
}

function getHandler( event: string ) {
	const calls = vi.mocked( autoUpdater.on ).mock.calls as unknown as [
		string,
		( ...args: unknown[] ) => Promise< void > | void,
	][];
	return calls.filter( ( [ name ] ) => name === event ).at( -1 )?.[ 1 ];
}

beforeEach( () => {
	userData = {};
	Object.defineProperty( process, 'platform', { value: 'darwin', configurable: true } );
	vi.mocked( autoUpdater.checkForUpdates ).mockClear();
	vi.mocked( autoUpdater.on ).mockClear();
	vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
		response: 1,
		checkboxChecked: false,
	} );
	vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	Object.defineProperty( process, 'platform', { value: originalPlatform, configurable: true } );
} );

describe( 'macOS update that fails to install', () => {
	it( 'remembers the downloaded version', async () => {
		vi.mocked( app.getVersion ).mockReturnValue( '1.21.0' );
		const { setupUpdates } = await loadPackagedUpdater();
		setupUpdates();

		await getHandler( 'update-downloaded' )?.( {}, 'notes', '2.2.0' );

		expect( userData.pendingAppUpdate ).toEqual( { version: '2.2.0', failedLaunches: 0 } );
	} );

	it( 'keeps checking on the first launch that still runs the old version', async () => {
		vi.mocked( app.getVersion ).mockReturnValue( '1.21.0' );
		userData = { pendingAppUpdate: { version: '2.2.0', failedLaunches: 0 } };
		const { setupUpdates } = await loadPackagedUpdater();

		setupUpdates();

		await vi.waitFor( () => expect( autoUpdater.checkForUpdates ).toHaveBeenCalled() );
		expect( userData.pendingAppUpdate ).toEqual( { version: '2.2.0', failedLaunches: 1 } );
	} );

	it( 'stops downloading and offers a manual download once it keeps failing', async () => {
		vi.mocked( app.getVersion ).mockReturnValue( '1.21.0' );
		userData = { pendingAppUpdate: { version: '2.2.0', failedLaunches: 1 } };
		const { setupUpdates, getAutoUpdaterState } = await loadPackagedUpdater();

		setupUpdates();

		await vi.waitFor( () => expect( dialog.showMessageBox ).toHaveBeenCalled() );
		expect( autoUpdater.checkForUpdates ).not.toHaveBeenCalled();
		expect( getAutoUpdaterState() ).toBe( 'done' );
	} );

	it( 'forgets the pending update once the new version is running', async () => {
		vi.mocked( app.getVersion ).mockReturnValue( '2.2.0' );
		userData = { pendingAppUpdate: { version: '2.2.0', failedLaunches: 1 } };
		const { setupUpdates } = await loadPackagedUpdater();

		setupUpdates();

		await vi.waitFor( () => expect( autoUpdater.checkForUpdates ).toHaveBeenCalled() );
		expect( userData.pendingAppUpdate ).toBeUndefined();
	} );
} );
