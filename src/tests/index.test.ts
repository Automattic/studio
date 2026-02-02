/**
 * @vitest-environment node
 */
import fs from 'fs';
import { normalize } from 'path';
import { vi, beforeAll, afterAll } from 'vitest';
import { createMainWindow, getMainWindow } from 'src/main-window';
import { setupWPServerFiles } from 'src/setup-wp-server-files';

vi.mock( 'fs' );
vi.mock( 'file-stream-rotator' );
vi.mock( 'src/main-window' );
vi.mock( 'src/updates' );
vi.mock( '@sentry/electron/main', () => ( {
	init: vi.fn(),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	setUser: vi.fn(),
} ) );
vi.mock( 'common/lib/bump-stat', () => ( {
	bumpStat: vi.fn(),
	bumpAggregatedUniqueStat: vi.fn( () => Promise.resolve() ),
} ) );
vi.mock( 'src/lib/user-data-watcher' );
vi.mock( 'src/setup-wp-server-files', () => ( {
	setupWPServerFiles: vi.fn( () => Promise.resolve() ),
	updateWPServerFiles: vi.fn( () => Promise.resolve() ),
} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn().mockResolvedValue( Buffer.from( JSON.stringify( { sites: [] } ) ) ),
	writeFile: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getUserDataFilePath: vi.fn().mockReturnValue( '/mock/userdata.json' ),
	getUserDataLockFilePath: vi.fn().mockReturnValue( '/mock/userdata.json.lock' ),
	getUserDataCertificatesPath: vi.fn().mockReturnValue( '/mock/certificates' ),
	getServerFilesPath: vi.fn().mockReturnValue( '/mock/server/files' ),
	getCliPath: vi.fn().mockReturnValue( '/mock/cli/path' ),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue( '/mock/node/binary' ),
	getSiteThumbnailPath: vi.fn().mockReturnValue( '/mock/thumbnail.png' ),
	DEFAULT_SITE_PATH: '/mock/default/site/path',
} ) );
vi.mock( 'src/modules/cli/lib/execute-command', () => {
	const mockEventEmitter = {
		on: vi.fn().mockImplementation( ( event: string, callback: () => void ) => {
			if ( event === 'started' ) {
				// Call started callback immediately
				setTimeout( () => callback(), 0 );
			}
			return mockEventEmitter;
		} ),
		emit: vi.fn(),
		removeAllListeners: vi.fn(),
	};
	const mockChildProcess = {
		on: vi.fn(),
		removeAllListeners: vi.fn(),
		kill: vi.fn(),
	};
	return {
		executeCliCommand: vi.fn().mockReturnValue( [ mockEventEmitter, mockChildProcess ] ),
	};
} );
vi.mock( 'src/modules/cli/lib/windows-installation-manager', () => ( {
	updateWindowsCliVersionedPathIfNeeded: vi.fn().mockReturnValue( Promise.resolve() ),
} ) );
jest.mock( 'electron-devtools-installer', () => ( {
	installExtension: jest.fn( () => Promise.resolve( { id: 'test-extension' } ) ),
	REACT_DEVELOPER_TOOLS: { id: 'fmkadmapgofadopljbjfkapdkoienihi' },
	REDUX_DEVTOOLS: { id: 'lmhkpmbekcpmknklioeibfkpmmfibljd' },
} ) );

// Setup fs mock file contents
if ( '__setFileContents' in fs ) {
	(
		fs as typeof fs & { __setFileContents: ( path: string, contents: string | string[] ) => void }
	 ).__setFileContents( normalize( '/path/to/app/temp/com.wordpress.studio/' ), '' );
}

const mockWatcher = {
	close: vi.fn(),
};
vi.mocked( fs.watch, { partial: true } ).mockReturnValue( mockWatcher );

function mockElectron() {
	const mockedEvents: Record< string, ( ...args: any[] ) => Promise< void > > = {};

	vi.doMock( 'electron', () => {
		return {
			app: {
				on: vi.fn( ( event, callback ) => {
					mockedEvents[ event ] = callback;
				} ),
				off: vi.fn(),
				getVersion: vi.fn().mockReturnValue( '1.0.0' ),
				getPath: vi.fn( ( name: string ) => {
					switch ( name ) {
						case 'home':
							return '/mock/home/path';
						case 'appData':
							return process.platform === 'win32'
								? 'C:\\Users\\TestUser\\AppData\\Roaming'
								: '/mock/home/path/.config';
						case 'userData':
							return '/mock/user/data';
						default:
							return '/mock/path';
					}
				} ),
				requestSingleInstanceLock: vi.fn().mockReturnValue( true ),
				quit: vi.fn(),
				setName: vi.fn(),
				setAsDefaultProtocolClient: vi.fn(),
				enableSandbox: vi.fn(),
				setAppLogsPath: vi.fn(),
				getLocale: vi.fn().mockReturnValue( 'en-US' ),
				getSystemLocale: vi.fn().mockReturnValue( 'en-US' ),
				isPackaged: false,
			},
			session: {
				defaultSession: {
					extensions: {
						getAllExtensions: vi.fn().mockReturnValue( [] ),
						loadExtension: vi.fn().mockResolvedValue( { id: 'test-extension' } ),
					},
					serviceWorkers: {
						startWorkerForScope: vi.fn().mockResolvedValue( undefined ),
					},
					setPermissionRequestHandler: vi.fn(),
					webRequest: {
						onHeadersReceived: vi.fn(),
					},
				},
			},
			BrowserWindow: Object.assign( vi.fn(), {
				getAllWindows: vi.fn().mockReturnValue( [] ),
			} ),
			ipcMain: {
				on: vi.fn(),
				handle: vi.fn(),
			},
			Menu: {
				setApplicationMenu: vi.fn(),
			},
			globalShortcut: {
				register: vi.fn(),
				unregister: vi.fn(),
				unregisterAll: vi.fn(),
			},
			dialog: {
				showMessageBox: vi.fn(),
				showMessageBoxSync: vi.fn(),
			},
		};
	} );

	return { mockedEvents };
}

// Silence `console.log`, `console.warn`, and `console.error` output
beforeAll( () => {
	vi.spyOn( console, 'log' ).mockImplementation( () => {} );
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	vi.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	vi.spyOn( console, 'log' ).mockRestore();
	vi.spyOn( console, 'warn' ).mockRestore();
	vi.spyOn( console, 'error' ).mockRestore();
} );

describe( 'App initialization', () => {
	it( 'should boot successfully', async () => {
		mockElectron();
		vi.resetModules();
		await expect( import( '../index' ) ).resolves.toBeDefined();
	} );

	it( 'should handle authentication deep links', async () => {
		const originalProcessPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'darwin' } );

		const { mockedEvents } = mockElectron();
		const mockHandleDeeplink = vi.fn();
		vi.doMock( '../lib/deeplink', () => ( { handleDeeplink: mockHandleDeeplink } ) );

		vi.resetModules();
		await import( '../index' );
		const { 'open-url': openUrl } = mockedEvents;

		const testUrl = 'wp-studio://auth#test-hash';
		await openUrl( {}, testUrl );
		expect( mockHandleDeeplink ).toHaveBeenCalledWith( testUrl );

		Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );
	} );

	it( 'should setup server files before creating main window', async () => {
		const { mockedEvents } = mockElectron();
		const setupSpy = vi.fn();
		vi.mocked( setupWPServerFiles ).mockImplementation( () => {
			setupSpy();
			return Promise.resolve();
		} );

		vi.resetModules();
		await import( '../index' );
		await mockedEvents.ready();

		expect( setupSpy ).toHaveBeenCalled();
		expect( setupSpy.mock.calls.length ).toBeGreaterThan( 0 );
		expect( vi.mocked( createMainWindow ).mock.calls.length ).toBeGreaterThan( 0 );

		await mockedEvents[ 'will-quit' ]( { preventDefault: vi.fn() } );
	} );

	it( 'should wait for app initialization before handling window events', async () => {
		const { mockedEvents } = mockElectron();
		vi.resetModules();
		await import( '../index' );

		// Before ready
		await mockedEvents.activate();
		expect( createMainWindow ).not.toHaveBeenCalled();

		// After ready
		await mockedEvents.ready();
		await mockedEvents.activate();
		expect( createMainWindow ).toHaveBeenCalled();

		await mockedEvents[ 'will-quit' ]( { preventDefault: vi.fn() } );
	} );

	it( 'should wait app initialization before creating main window via second-instance event', async () => {
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
			focus: vi.fn(),
			isMinimized: vi.fn( () => false ),
		} );

		const { mockedEvents } = mockElectron();

		// The "second-instance" event is only invoked on Windows/Linux platforms.
		// Therefore, we ensure the initialization is performed on one of those
		// platforms.
		const originalProcessPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		vi.resetModules();
		await import( '../index' );
		const { ready, 'second-instance': secondInstance } = mockedEvents;

		await secondInstance();
		// "getMainWindow" creates the main window if it doesn't exist
		expect( vi.mocked( getMainWindow ) ).not.toHaveBeenCalled();

		await ready();

		await secondInstance();
		expect( vi.mocked( getMainWindow ) ).toHaveBeenCalled();

		Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );

		await mockedEvents[ 'will-quit' ]( { preventDefault: vi.fn() } );
	} );
} );
