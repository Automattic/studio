/**
 * @jest-environment node
 */
import { BrowserWindow } from 'electron';
import fs from 'fs';
import { createMainWindow, withMainWindow, __resetMainWindow } from '../main-window';

jest.mock( 'fs' );

const mockUserData = {
	sites: [],
};
( fs as MockedFs ).__setFileContents(
	'/path/to/app/appData/App Name/appdata-v1.json',
	JSON.stringify( mockUserData )
);

describe( 'withMainWindow', () => {
	let createdWindow: BrowserWindow;

	beforeEach( () => {
		createdWindow = createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'passes the main window to the callback when the reference is set', () => {
		const callback = jest.fn();

		withMainWindow( callback );

		expect( callback ).toHaveBeenCalledWith( createdWindow );
	} );

	it( 'passes the focused window to the callback when the reference is destroyed', () => {
		const callback = jest.fn();
		const mockWindow1 = { foo: 'foo' };
		const mockWindow2 = { bar: 'bar' };
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
		( BrowserWindow.getFocusedWindow as jest.Mock ).mockReturnValueOnce( mockWindow2 );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [
			mockWindow1,
			mockWindow2,
		] );

		withMainWindow( callback );

		expect( callback ).toHaveBeenCalledWith( mockWindow2 );
	} );

	it( 'passes the first window to the callback when the reference is destroyed and no window is focused', () => {
		const callback = jest.fn();
		const mockWindow1 = { bim: 'bim' };
		const mockWindow2 = { bam: 'bam' };
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
		( BrowserWindow.getAllWindows as jest.Mock ).mockReturnValueOnce( [
			mockWindow1,
			mockWindow2,
		] );

		withMainWindow( callback );

		expect( callback ).toHaveBeenCalledWith( mockWindow1 );
	} );

	it( 'passes the main window to the callback when no non-destroyed windows exist', () => {
		const callback = jest.fn();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let didFinishLoad: ( ...args: any[] ) => void = () => {};
		( createdWindow.isDestroyed as jest.Mock ).mockReturnValue( true );
		( BrowserWindow.prototype.webContents.on as jest.Mock ).mockImplementation(
			( _event, callback ) => {
				didFinishLoad = callback;
			}
		);

		withMainWindow( callback );
		didFinishLoad();

		// Assert any `BrowserWindow` as mocking the return of `createMainWindow`
		// within `withMainWindow` is difficult.
		expect( callback ).toHaveBeenCalledWith( expect.any( BrowserWindow ) );
	} );
} );
