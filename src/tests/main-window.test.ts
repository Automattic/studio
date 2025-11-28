/**
 * @jest-environment node
 */
import { BrowserWindow } from 'electron';
import { normalize } from 'path';
import { readFile } from 'atomically';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { createMainWindow, getMainWindow, __resetMainWindow } from 'src/main-window';

jest.mock( 'fs' );
jest.mock( 'src/ipc-utils' );
jest.mock( 'atomically' );

const mockUserData = {
	sites: [],
};
require( 'fs' ).__setFileContents(
	normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
	JSON.stringify( mockUserData )
);
( readFile as jest.Mock ).mockResolvedValue( JSON.stringify( mockUserData ) );

describe( 'getMainWindow', () => {
	let createdWindow: BrowserWindow;

	beforeEach( async () => {
		createdWindow = await createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'returns the main window when the reference is set', async () => {
		const window = await getMainWindow();
		expect( window ).toBe( createdWindow );
	} );

	it( 'returns the focused window when the reference is destroyed', async () => {
		const mockWindow1 = new BrowserWindow();
		const mockWindow2 = new BrowserWindow();
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValueOnce( true );
		( BrowserWindow.getFocusedWindow as jest.Mock ).mockReturnValueOnce( mockWindow2 );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [
			mockWindow1,
			mockWindow2,
		] );

		const window = await getMainWindow();
		expect( window ).toBe( mockWindow2 );
	} );

	it( 'returns the first window when the reference is destroyed and no window is focused', async () => {
		const mockWindow1 = new BrowserWindow();
		const mockWindow2 = new BrowserWindow();
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValueOnce( true );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [
			mockWindow1,
			mockWindow2,
		] );

		const window = await getMainWindow();
		expect( window ).toBe( mockWindow1 );
	} );

	it( 'returns a new window when no non-destroyed windows exist', async () => {
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValueOnce( true );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [] );

		// Create a new mock window
		const newMockWindow = new BrowserWindow();

		// Mock the createMainWindow function
		const createMainWindowModule = require( 'src/main-window' );
		const originalCreateMainWindow = createMainWindowModule.createMainWindow;
		createMainWindowModule.createMainWindow = jest.fn().mockResolvedValue( newMockWindow );

		// Mock the did-finish-load event to resolve immediately
		( newMockWindow.webContents.on as jest.Mock ).mockImplementation( ( event, callback ) => {
			if ( event === 'did-finish-load' ) {
				// Call the callback immediately
				setImmediate( callback );
			}
		} );

		const window = await getMainWindow();

		expect( window ).toBeInstanceOf( BrowserWindow );
		expect( window ).toStrictEqual( newMockWindow );

		// Restore the original function
		createMainWindowModule.createMainWindow = originalCreateMainWindow;
	} );
} );

describe( 'fullscreen events', () => {
	let createdWindow: BrowserWindow;

	beforeEach( async () => {
		createdWindow = await createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'sends fullscreen-change event when entering fullscreen', () => {
		// Simulate entering fullscreen
		createdWindow.emit( 'enter-full-screen' );

		expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
			createdWindow,
			'window-fullscreen-change',
			true
		);
	} );

	it( 'sends fullscreen-change event when leaving fullscreen', () => {
		// Simulate leaving fullscreen
		createdWindow.emit( 'leave-full-screen' );

		expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
			createdWindow,
			'window-fullscreen-change',
			false
		);
	} );
} );
