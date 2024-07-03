/**
 * @jest-environment node
 */
import fs from 'fs';
import { createMainWindow, withMainWindow } from '../main-window';
import { setupWPServerFiles } from '../setup-wp-server-files';

jest.mock( 'fs' );
jest.mock( 'file-stream-rotator' );
jest.mock( '../main-window' );
jest.mock( '../updates' );
jest.mock( '../lib/bump-stats' );
jest.mock( '../lib/cli' );
jest.mock( '../setup-wp-server-files', () => ( {
	setupWPServerFiles: jest.fn( () => Promise.resolve() ),
	updateWPServerFiles: jest.fn( () => Promise.resolve() ),
} ) );

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);
( fs as MockedFs ).__setFileContents( '/path/to/app/temp/com.wordpress.studio/', '' );

function mockElectron(
	{
		appEvents,
		appMocks,
		electronMocks,
	}: {
		appEvents: string[];
		electronMocks?: Partial< typeof import('electron') >;
		appMocks?: Partial< typeof import('electron').app >;
	} = {
		appEvents: [],
	}
) {
	const mockedEvents = appEvents.reduce< Record< string, ( ...args: any[] ) => Promise< void > > >(
		( accum, event ) => {
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			return { ...accum, [ event ]: async () => {} };
		},
		{}
	);
	jest.doMock( 'electron', () => {
		const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
		return {
			...electron,
			...electronMocks,
			app: {
				...electron.app,
				...appMocks,
				on: jest.fn( ( event, callback ) => {
					const mockedEventName = Object.keys( mockedEvents ).find( ( key ) => key === event );
					if ( mockedEventName ) {
						mockedEvents[ mockedEventName ] = callback;
					}
				} ),
			},
		};
	} );
	return { mockedEvents };
}

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
		const mockIpcMainEmit = jest.fn();
		const electron = jest.genMockFromModule( 'electron' ) as typeof import('electron');
		const { mockedEvents } = mockElectron( {
			appEvents: [ 'open-url' ],
			electronMocks: {
				ipcMain: {
					...electron.ipcMain,
					emit: mockIpcMainEmit,
				},
			},
		} );
		const mockAuthResult = { email: 'mock-email', displayName: 'mock-display-name' };
		const mockResolvedValue = Promise.resolve( mockAuthResult );
		const mockHandleAuthCallback = jest.fn( () => mockResolvedValue );
		jest.doMock( '../lib/oauth', () => ( {
			setUpAuthCallbackHandler: jest.fn(),
			handleAuthCallback: mockHandleAuthCallback,
		} ) );
		require( '../index' );
		const { 'open-url': openUrl } = mockedEvents;

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

it( 'should setup server files before creating main window', async () => {
	await jest.isolateModulesAsync( async () => {
		const { mockedEvents } = mockElectron( { appEvents: [ 'ready' ] } );
		require( '../index' );
		const { ready } = mockedEvents;

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

it( 'should wait app initialization before creating main window via activate event', async () => {
	await jest.isolateModulesAsync( async () => {
		const { mockedEvents } = mockElectron( { appEvents: [ 'ready', 'activate' ] } );

		require( '../index' );
		const { ready, activate } = mockedEvents;

		await activate();
		expect( createMainWindow as jest.Mock ).not.toHaveBeenCalled();

		await ready();

		await activate();
		expect( createMainWindow as jest.Mock ).toHaveBeenCalled();
	} );
} );

it( 'should wait app initialization before creating main window via second-instance event', async () => {
	await jest.isolateModulesAsync( async () => {
		const { mockedEvents } = mockElectron( { appEvents: [ 'ready', 'second-instance' ] } );

		// The "second-instance" event is only invoked on Windows/Linux platforms.
		// Therefore, we ensure the initialization is performed on one of those
		// platforms.
		const originalProcessPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'win32' } );

		require( '../index' );
		const { ready, 'second-instance': secondInstance } = mockedEvents;

		await secondInstance();
		// "withMainWindow" creates the main window if it doesn't exist
		expect( withMainWindow as jest.Mock ).not.toHaveBeenCalled();

		await ready();

		await secondInstance();
		expect( withMainWindow as jest.Mock ).toHaveBeenCalled();

		Object.defineProperty( process, 'platform', { value: originalProcessPlatform } );
	} );
} );
