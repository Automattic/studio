/**
 * @vitest-environment node
 */
import fs from 'fs';
import { normalize } from 'path';
import { vol } from 'memfs';
import { vi, beforeAll, afterAll } from 'vitest';
import { createMainWindow, getMainWindow } from 'src/main-window';

vi.mock( 'fs' );
vi.mock( 'file-stream-rotator' );
vi.mock( 'src/main-window' );
vi.mock( 'src/updates' );
vi.mock( '@sentry/electron/main', () => ( {
	init: vi.fn(),
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	setUser: vi.fn(),
	setTag: vi.fn(),
} ) );
vi.mock( import( 'src/lib/bump-stats' ), async ( importOriginal ) => {
	const actual = await importOriginal();
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue( undefined ),
	};
} );
vi.mock( 'src/lib/user-data-watcher' );
vi.mock( 'src/setup-wp-server-files', () => ( {
	setupWPServerFiles: vi.fn().mockResolvedValue( undefined ),
	updateWPServerFiles: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'atomically', () => ( {
	readFile: vi.fn().mockResolvedValue( Buffer.from( JSON.stringify( { sites: [] } ) ) ),
	writeFile: vi.fn(),
} ) );
vi.mock( 'src/modules/cli/lib/execute-command', () => {
	const mockEventEmitter = {
		on: vi.fn().mockImplementation( ( event: string, callback: ( ...args: any[] ) => void ) => {
			if ( event === 'started' ) {
				setTimeout( () => callback(), 0 );
			}
			if ( event === 'success' ) {
				setTimeout( () => callback( { result: { stdout: '[]', stderr: '' } } ), 0 );
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
		getTracksOriginEnv: vi.fn( () => 'studio-ui:v1' ),
	};
} );
vi.mock( 'src/modules/cli/lib/windows-installation-manager', () => ( {
	autoInstallWindowsCliIfNeeded: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/modules/cli/lib/macos-installation-manager', () => ( {
	autoInstallMacOSCliIfNeeded: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/modules/cli/lib/linux-installation-manager', () => ( {
	autoInstallLinuxCliIfNeeded: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'src/modules/remote-session/daemon-status-poller', () => ( {
	// Started during `appBoot()`; its initial tick calls `sendIpcEventToRenderer`,
	// which races the partial `getMainWindow()` mock used in these tests. The
	// poller itself is covered by its own unit-test file, so stubbing it here
	// keeps this suite focused on app-boot bookkeeping.
	startRemoteSessionStatusPolling: vi.fn().mockReturnValue( () => undefined ),
} ) );
vi.mock( 'electron-squirrel-startup', () => ( { default: false } ) );
vi.mock( 'electron-devtools-installer', () => ( {
	installExtension: vi.fn().mockResolvedValue( { id: 'test-extension' } ),
	REACT_DEVELOPER_TOOLS: { id: 'fmkadmapgofadopljbjfkapdkoienihi' },
	REDUX_DEVTOOLS: { id: 'lmhkpmbekcpmknklioeibfkpmmfibljd' },
} ) );

vol.mkdirSync( normalize( '/path/to/app/temp/com.wordpress.studio' ), { recursive: true } );

const mockWatcher = {
	close: vi.fn(),
};
vi.mocked( fs.watch, { partial: true } ).mockReturnValue( mockWatcher );

type OnBeforeSendHeadersListener = (
	details: { requestHeaders: Record< string, string > },
	callback: ( response: { requestHeaders: Record< string, string > } ) => void
) => void;

function mockElectron() {
	const mockedEvents: Record< string, ( ...args: any[] ) => Promise< void > > = {};

	vi.doMock( 'electron', () => {
		return {
			app: {
				on: vi.fn().mockImplementation( ( event, callback ) => {
					mockedEvents[ event ] = callback;
				} ),
				off: vi.fn(),
				getVersion: vi.fn().mockReturnValue( '1.0.0' ),
				getPath: vi.fn().mockImplementation( ( name: string ) => {
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
				exit: vi.fn(),
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
						onBeforeSendHeaders: vi.fn(),
						onHeadersReceived: vi.fn(),
					},
				},
			},
			BrowserWindow: Object.assign( vi.fn(), {
				getAllWindows: vi.fn().mockReturnValue( [] ),
				getFocusedWindow: vi.fn().mockReturnValue( null ),
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
	}, 10_000 );

	it( 'should identify YouTube embed requests with the Studio referrer', async () => {
		const { mockedEvents } = mockElectron();
		vi.resetModules();
		const { session } = await import( 'electron' );
		await import( '../index' );

		await mockedEvents.ready();
		const onBeforeSendHeaders = session.defaultSession.webRequest
			.onBeforeSendHeaders as unknown as ReturnType< typeof vi.fn >;

		expect( onBeforeSendHeaders ).toHaveBeenCalledWith(
			{
				urls: [
					'https://*.youtube.com/embed/*',
					'https://youtube.com/embed/*',
					'https://*.youtube-nocookie.com/embed/*',
					'https://youtube-nocookie.com/embed/*',
				],
			},
			expect.any( Function )
		);

		const listener = onBeforeSendHeaders.mock.calls[ 0 ][ 1 ] as OnBeforeSendHeadersListener;
		const callback = vi.fn();
		listener(
			{
				requestHeaders: {
					Accept: 'text/html',
					referer: 'http://localhost:5173/',
				},
			},
			callback
		);

		expect( callback ).toHaveBeenCalledWith( {
			requestHeaders: {
				Accept: 'text/html',
				Referer: 'https://developer.wordpress.com/studio/',
			},
		} );
	} );

	describe( 'unsaved changes in the site preview', () => {
		// Electron inverts the usual contract here: `preventDefault()` on
		// `will-prevent-unload` *allows* the page to be unloaded, and doing
		// nothing keeps the user on the page.
		async function captureUnloadListener( contentsType: string ) {
			const { mockedEvents } = mockElectron();
			vi.resetModules();
			const electron = await import( 'electron' );
			await import( '../index' );
			await mockedEvents.ready();

			const contents = {
				getType: () => contentsType,
				on: vi.fn(),
				setWindowOpenHandler: vi.fn(),
			};
			await mockedEvents[ 'web-contents-created' ]( {}, contents );

			const listener = contents.on.mock.calls.find(
				( [ event ] ) => event === 'will-prevent-unload'
			)?.[ 1 ] as ( ( event: { preventDefault: () => void } ) => void ) | undefined;

			return { listener, dialog: electron.dialog };
		}

		it( 'should unload the page when the user chooses to leave', async () => {
			const { listener, dialog } = await captureUnloadListener( 'webview' );
			vi.mocked( dialog.showMessageBoxSync ).mockReturnValue( 0 );
			const event = { preventDefault: vi.fn() };

			listener?.( event );

			expect( dialog.showMessageBoxSync ).toHaveBeenCalledWith(
				expect.objectContaining( {
					message: 'Leave page with unsaved changes?',
					buttons: [ 'Leave', 'Stay' ],
				} )
			);
			expect( event.preventDefault ).toHaveBeenCalled();
		} );

		it( 'should keep the page when the user chooses to stay', async () => {
			const { listener, dialog } = await captureUnloadListener( 'webview' );
			vi.mocked( dialog.showMessageBoxSync ).mockReturnValue( 1 );
			const event = { preventDefault: vi.fn() };

			listener?.( event );

			expect( dialog.showMessageBoxSync ).toHaveBeenCalled();
			expect( event.preventDefault ).not.toHaveBeenCalled();
		} );

		it( 'should not prompt for web contents outside the site preview', async () => {
			const { listener, dialog } = await captureUnloadListener( 'window' );
			const event = { preventDefault: vi.fn() };

			expect( listener ).toBeDefined();
			listener?.( event );

			expect( dialog.showMessageBoxSync ).not.toHaveBeenCalled();
			expect( event.preventDefault ).not.toHaveBeenCalled();
		} );
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

	it( 'should show the quit-sites dialog with keep-running choices', async () => {
		vi.doMock( 'src/site-server', () => ( {
			getRunningSiteCount: vi.fn().mockReturnValue( 1 ),
			persistAutoStartForRunningSites: vi.fn().mockResolvedValue( undefined ),
			SiteServer: {
				fetchAll: vi.fn().mockResolvedValue( undefined ),
			},
			stopAllServers: vi.fn().mockResolvedValue( undefined ),
		} ) );
		const { mockedEvents } = mockElectron();

		vi.resetModules();
		await import( '../index' );
		const { app, dialog } = await import( 'electron' );
		const { persistAutoStartForRunningSites } = await import( 'src/site-server' );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: true,
		} );
		const event = { preventDefault: vi.fn() };

		void mockedEvents[ 'before-quit' ]( event );

		await vi.waitFor( () => {
			expect( dialog.showMessageBox ).toHaveBeenCalledWith( {
				type: 'question',
				message: 'Keep the site running?',
				detail: 'Your site can stay available in the background after Studio quits.',
				buttons: [ 'Stop site', 'Keep site running', 'Cancel' ],
				checkboxLabel: 'Remember my choice',
				cancelId: 2,
				defaultId: 0,
			} );
			expect( app.quit ).toHaveBeenCalled();
		} );
		expect( event.preventDefault ).toHaveBeenCalled();

		// "Stop site" must stop and stay stopped, so autoStart is cleared rather than preserved.
		const willQuitEvent = { preventDefault: vi.fn() };
		await mockedEvents[ 'will-quit' ]( willQuitEvent );
		expect( vi.mocked( persistAutoStartForRunningSites ) ).toHaveBeenCalledWith( false );
	} );

	it( 'should wait app initialization before creating main window via second-instance event', async () => {
		vi.mocked( getMainWindow, { partial: true } ).mockResolvedValue( {
			focus: vi.fn(),
			isMinimized: vi.fn().mockReturnValue( false ),
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
