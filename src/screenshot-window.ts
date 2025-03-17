import crypto from 'crypto';
import { BrowserWindow, session } from 'electron';
import { SCREENSHOT_HEIGHT, SCREENSHOT_WIDTH } from 'src/constants';

export function createScreenshotWindow( captureUrl: string ) {
	const newSession = session.fromPartition( crypto.randomUUID() );

	const window = new BrowserWindow( {
		height: SCREENSHOT_HEIGHT,
		width: SCREENSHOT_WIDTH,
		show: false,
		webPreferences: { session: newSession },
	} );

	const responseStatusCodePromise = new Promise< void >( ( resolve, reject ) => {
		newSession.webRequest.onCompleted( ( details ) => {
			if ( details.resourceType !== 'mainFrame' ) {
				return;
			}

			if ( details.statusCode < 200 || details.statusCode >= 400 ) {
				reject( new Error( `Page returned status code: ${ details.statusCode }` ) );
			} else {
				resolve();
			}
		} );
	} );

	const waitForCapture = async () => {
		await window.loadURL( captureUrl );
		await responseStatusCodePromise;
		await window.webContents.insertCSS( `
			body {
				overflow: hidden;
				height: 100vh;
			}
			::-webkit-scrollbar {
				display: none;
			}
		` );

		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
		return window.webContents.capturePage();
	};

	return { window, waitForCapture };
}
