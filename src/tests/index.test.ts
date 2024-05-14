/**
 * @jest-environment node
 */
import fs from 'fs';
import { createMainWindow } from '../main-window';

jest.mock( 'fs' );
jest.mock( 'file-stream-rotator' );
jest.mock( '../main-window' );

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);
( fs as MockedFs ).__setFileContents( '/path/to/app/temp/com.wordpress.studio/', '' );

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

it( 'should await the app ready state before creating a window for activate events', () => {
	jest.isolateModules( async () => {
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
