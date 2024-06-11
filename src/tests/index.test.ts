/**
 * @jest-environment node
 */
import fs from 'fs';
import { createMainWindow } from '../main-window';
import setupWPServerFiles from '../setup-wp-server-files';

jest.mock( 'fs' );
jest.mock( 'file-stream-rotator' );
jest.mock( '../main-window' );
jest.mock( '../updates' );
jest.mock( '../lib/bump-stats' );
jest.mock( '../setup-wp-server-files', () =>
	jest.fn( () => new Promise< void >( ( resolve ) => resolve() ) )
);

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);
( fs as MockedFs ).__setFileContents( '/path/to/app/temp/com.wordpress.studio/', '' );

afterEach( () => {
	jest.clearAllMocks();
} );

it( 'should boot successfully', () => {
	jest.isolateModules( () => {
		expect( () => require( '../index' ) ).not.toThrow();
	} );
} );

it( 'should handle authentication deep links', () => {
	jest.isolateModules( async () => {
		const originalProcessPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let openUrl: ( ...args: any[] ) => void = () => {};
		const mockIpcMainEmit = jest.fn();
		jest.doMock( 'electron', () => {
			const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
			return {
				...electron,
				ipcMain: {
					...electron.ipcMain,
					emit: mockIpcMainEmit,
				},
				app: {
					...electron.app,
					on: jest.fn( ( event, callback ) => {
						if ( event === 'open-url' ) {
							openUrl = callback;
						}
					} ),
				},
			};
		} );
		const mockAuthResult = { email: 'mock-email', displayName: 'mock-display-name' };
		const mockResolvedValue = Promise.resolve( mockAuthResult );
		const mockHandleAuthCallback = jest.fn( () => mockResolvedValue );
		jest.doMock( '../lib/oauth', () => ( {
			setUpAuthCallbackHandler: jest.fn(),
			handleAuthCallback: mockHandleAuthCallback,
		} ) );
		require( '../index' );

		const mockHash = '#access_token=1234&expires_in=1';
		openUrl( {}, `wpcom-local-dev://auth${ mockHash }` );
		await mockResolvedValue;

		expect( mockHandleAuthCallback ).toHaveBeenCalledWith( mockHash );
		expect( mockIpcMainEmit ).toHaveBeenCalledWith( 'auth-callback', null, {
			token: mockAuthResult,
		} );

		Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );
	} );
} );

it( 'should await the app ready state before creating a window for activate events', async () => {
	await jest.isolateModulesAsync( async () => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let activate: ( ...args: any[] ) => void = () => {};
		jest.doMock( 'electron', () => {
			const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
			return {
				...electron,
				app: {
					...electron.app,
					whenReady: jest.fn( () => Promise.resolve() ),
					on: jest.fn( ( event, callback ) => {
						if ( event === 'activate' ) {
							activate = callback;
						}
					} ),
				},
			};
		} );
		require( '../index' );

		activate();

		expect( createMainWindow ).not.toHaveBeenCalled();
		// Await the mocked `whenReady` promise resolution
		await new Promise( process.nextTick );
		expect( createMainWindow ).toHaveBeenCalled();
	} );
} );

it( 'should gracefully handle app ready failures when creating a window on activate', async () => {
	await jest.isolateModulesAsync( async () => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let activate: ( ...args: any[] ) => void = () => {};
		jest.doMock( 'electron', () => {
			const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
			return {
				...electron,
				app: {
					...electron.app,
					whenReady: jest.fn( () => Promise.reject() ),
					on: jest.fn( ( event, callback ) => {
						if ( event === 'activate' ) {
							activate = callback;
						}
					} ),
				},
			};
		} );
		const captureExceptionMock = jest.fn();
		jest.doMock( '@sentry/electron/main', () => ( {
			init: jest.fn(),
			captureException: captureExceptionMock,
		} ) );
		require( '../index' );

		activate();

		await new Promise( process.nextTick );
		expect( createMainWindow ).not.toHaveBeenCalled();
		expect( captureExceptionMock ).toHaveBeenCalled();
	} );
} );

it( 'should setup server files before creating main window', async () => {
	await jest.isolateModulesAsync( async () => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let ready: ( ...args: any[] ) => Promise< void > = async () => {};
		jest.doMock( 'electron', () => {
			const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
			return {
				...electron,
				app: {
					...electron.app,
					on: jest.fn( ( event, callback ) => {
						if ( event === 'ready' ) {
							ready = callback;
						}
					} ),
				},
			};
		} );
		require( '../index' );

		// Add a mock function to check that `setupWPServerFiles` is resolved before
		// creating the main window.
		const resolveFn = jest.fn();
		( setupWPServerFiles as jest.Mock ).mockImplementation( async () => {
			await new Promise( process.nextTick );
			resolveFn();
		} );

		await ready();

		expect( resolveFn ).toHaveBeenCalled();
		const setupWPServerFilesResolvedOrder = resolveFn.mock.invocationCallOrder[ 0 ];
		const createMainWindowOrder = ( createMainWindow as jest.Mock ).mock.invocationCallOrder[ 0 ];

		expect( setupWPServerFilesResolvedOrder ).toBeLessThan( createMainWindowOrder );
	} );
} );
