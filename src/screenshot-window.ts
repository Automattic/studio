import crypto from 'crypto';
import { BrowserWindow, session } from 'electron';
import { SCREENSHOT_HEIGHT, SCREENSHOT_WIDTH } from './constants';

export function createScreenshotWindow( captureUrl: string ) {
	const newSession = session.fromPartition( crypto.randomUUID() );

	const window = new BrowserWindow( {
		height: SCREENSHOT_HEIGHT,
		width: SCREENSHOT_WIDTH,
		show: false,
		webPreferences: { session: newSession },
	} );

	const finishedLoading = new Promise< void >( ( resolve ) => {
		window.webContents.on( 'did-finish-load', () => resolve() );
	} );

	window.loadURL( captureUrl );

	const waitForCapture = async () => {
		await finishedLoading;
		await window.webContents.insertCSS( '::-webkit-scrollbar { display: none; }' );
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		return window.webContents.capturePage();
	};

	return { window, waitForCapture };
}
