/**
 * @jest-environment node
 */
import fs from 'fs';
import { normalize } from 'path';
import { readFile } from 'atomically';
import { createMainWindow, getMainWindow } from 'src/main-window';
import { setupWPServerFiles } from 'src/setup-wp-server-files';

jest.mock( 'fs' );
jest.mock( 'file-stream-rotator' );
jest.mock( 'src/main-window' );
jest.mock( 'src/updates' );
jest.mock( 'common/lib/bump-stat', () => ( {
	bumpStat: jest.fn(),
	bumpAggregatedUniqueStat: jest.fn( () => Promise.resolve() ),
} ) );
jest.mock( 'src/lib/user-data-watcher' );
jest.mock( 'src/setup-wp-server-files', () => ( {
	setupWPServerFiles: jest.fn( () => Promise.resolve() ),
	updateWPServerFiles: jest.fn( () => Promise.resolve() ),
} ) );
jest.mock( 'atomically', () => ( {
	readFile: jest.fn(),
	writeFile: jest.fn(),
} ) );
jest.mock( 'electron-devtools-installer', () => ( {
	installExtension: jest.fn( () => Promise.resolve( { id: 'test-extension' } ) ),
	REACT_DEVELOPER_TOOLS: { id: 'fmkadmapgofadopljbjfkapdkoienihi' },
	REDUX_DEVTOOLS: { id: 'lmhkpmbekcpmknklioeibfkpmmfibljd' },
} ) );

( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( { sites: [] } ) );
require( 'fs' ).__setFileContents( normalize( '/path/to/app/temp/com.wordpress.studio/' ), '' );

const mockWatcher = {
	close: jest.fn(),
};
fs.watch = jest.fn().mockReturnValue( mockWatcher ) as unknown as typeof fs.watch;

function mockElectron() {
	const mockedEvents: Record< string, ( ...args: any[] ) => Promise< void > > = {};

	jest.doMock( 'electron', () => {
		const electron = jest.createMockFromModule(
			'electron'
		) as unknown as typeof import('electron');

		return {
			...electron,
			app: {
				...electron.app,
				on: jest.fn( ( event, callback ) => {
					mockedEvents[ event ] = callback;
				} ),
			},
			session: {
				defaultSession: {
					...electron.session.defaultSession,
					extensions: {
						getAllExtensions: jest.fn().mockReturnValue( [] ),
						loadExtension: jest.fn().mockResolvedValue( { id: 'test-extension' } ),
					},
					serviceWorkers: {
						startWorkerForScope: jest.fn().mockResolvedValue( undefined ),
					},
				},
			},
		};
	} );

	return { mockedEvents };
}

// Silence `console.log`, `console.warn`, and `console.error` output
beforeAll( () => {
	jest.spyOn( console, 'log' ).mockImplementation( () => {} );
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
} );

afterAll( () => {
	jest.spyOn( console, 'log' ).mockRestore();
	jest.spyOn( console, 'warn' ).mockRestore();
	jest.spyOn( console, 'error' ).mockRestore();
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'App initialization', () => {
	it( 'should boot successfully', () => {
		jest.isolateModules( () => {
			expect( () => require( '../index' ) ).not.toThrow();
		} );
	} );

	it( 'should handle authentication deep links', () => {
		jest.isolateModules( async () => {
			const originalProcessPlatform = process.platform;
			Object.defineProperty( process, 'platform', { value: 'darwin' } );

			const { mockedEvents } = mockElectron();
			const mockHandleDeeplink = jest.fn();
			jest.doMock( '../lib/deeplink', () => ( { handleDeeplink: mockHandleDeeplink } ) );

			require( '../index' );
			const { 'open-url': openUrl } = mockedEvents;

			const testUrl = 'wp-studio://auth#test-hash';
			await openUrl( {}, testUrl );
			expect( mockHandleDeeplink ).toHaveBeenCalledWith( testUrl );

			Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );
		} );
	} );

	it( 'should setup server files before creating main window', async () => {
		await jest.isolateModulesAsync( async () => {
			const { mockedEvents } = mockElectron();
			const setupSpy = jest.fn();
			( setupWPServerFiles as jest.Mock ).mockImplementation( () => {
				setupSpy();
				return Promise.resolve();
			} );

			require( '../index' );
			await mockedEvents.ready();

			expect( setupSpy ).toHaveBeenCalled();
			expect( setupSpy.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
				( createMainWindow as jest.Mock ).mock.invocationCallOrder[ 0 ]
			);

			await mockedEvents[ 'will-quit' ]( { preventDefault: jest.fn() } );
		} );
	} );

	it( 'should wait for app initialization before handling window events', async () => {
		await jest.isolateModulesAsync( async () => {
			const { mockedEvents } = mockElectron();
			require( '../index' );

			// Before ready
			await mockedEvents.activate();
			expect( createMainWindow ).not.toHaveBeenCalled();

			// After ready
			await mockedEvents.ready();
			await mockedEvents.activate();
			expect( createMainWindow ).toHaveBeenCalled();

			await mockedEvents[ 'will-quit' ]( { preventDefault: jest.fn() } );
		} );
	} );

	it( 'should wait app initialization before creating main window via second-instance event', async () => {
		await jest.isolateModulesAsync( async () => {
			( getMainWindow as jest.Mock ).mockResolvedValue( {
				focus: jest.fn(),
				isMinimized: jest.fn( () => false ),
			} );

			const { mockedEvents } = mockElectron();

			// The "second-instance" event is only invoked on Windows/Linux platforms.
			// Therefore, we ensure the initialization is performed on one of those
			// platforms.
			const originalProcessPlatform = process.platform;
			Object.defineProperty( process, 'platform', { value: 'win32' } );

			require( '../index' );
			const { ready, 'second-instance': secondInstance } = mockedEvents;

			await secondInstance();
			// "getMainWindow" creates the main window if it doesn't exist
			expect( getMainWindow as jest.Mock ).not.toHaveBeenCalled();

			await ready();

			await secondInstance();
			expect( getMainWindow as jest.Mock ).toHaveBeenCalled();

			Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );

			await mockedEvents[ 'will-quit' ]( { preventDefault: jest.fn() } );
		} );
	} );
} );
