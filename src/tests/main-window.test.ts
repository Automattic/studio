/**
 * @jest-environment node
 */
import { BrowserWindow } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import { createMainWindow, getMainWindow, __resetMainWindow } from '../main-window';

jest.mock( 'fs' );

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
	JSON.stringify( mockUserData )
);

describe( 'getMainWindow', () => {
	let createdWindow: BrowserWindow;

	beforeEach( () => {
		createdWindow = createMainWindow();
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
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
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
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [
			mockWindow1,
			mockWindow2,
		] );

		const window = await getMainWindow();
		expect( window ).toBe( mockWindow1 );
	} );

	it( 'returns a new window when no non-destroyed windows exist', async () => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let didFinishLoad: ( ...args: any[] ) => void = () => {};
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
		( BrowserWindow.prototype.webContents.on as jest.Mock ).mockImplementation(
			( _event, callback ) => {
				didFinishLoad = callback;
			}
		);

		const windowPromise = getMainWindow();
		didFinishLoad();
		const window = await windowPromise;

		expect( window ).toBeInstanceOf( BrowserWindow );
	} );
} );

describe( 'fullscreen events', () => {
	let createdWindow: BrowserWindow;

	beforeEach( () => {
		createdWindow = createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'sends fullscreen-change event when entering fullscreen', () => {
		const mockSend = jest.fn();
		createdWindow.webContents.send = mockSend;

		// Simulate entering fullscreen
		createdWindow.emit( 'enter-full-screen' );

		expect( mockSend ).toHaveBeenCalledWith( 'window-fullscreen-change', true );
	} );

	it( 'sends fullscreen-change event when leaving fullscreen', () => {
		const mockSend = jest.fn();
		createdWindow.webContents.send = mockSend;

		// Simulate leaving fullscreen
		createdWindow.emit( 'leave-full-screen' );

		expect( mockSend ).toHaveBeenCalledWith( 'window-fullscreen-change', false );
	} );
} );
