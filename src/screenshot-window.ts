import crypto from 'crypto';
import { BrowserWindow, session } from 'electron';
import { SCREENSHOT_HEIGHT, SCREENSHOT_WIDTH } from 'src/constants';

export function createScreenshotWindow( captureUrl: string ) {
	const newSession = session.fromPartition( crypto.randomUUID() );

	// Accept unsafe HTTPS certificates
	newSession.setCertificateVerifyProc( ( request, callback ) => {
		callback( 0 );
	} );

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
			body, html {
				overflow: hidden;
				height: 100vh;
			}
			::-webkit-scrollbar {
				display: none;
			}
			#wpadminbar {
				display: none !important;
			}
			html.admin-bar {
				margin-top: 0 !important;
			}
			html.admin-bar body {
				margin-top: 0 !important;
				padding-top: 0 !important;
			}
		` );

		// Oftentimes, web pages need a bit more time for images to load and layouts to settle
		const LOAD_TIMEOUT = process.platform === 'win32' ? 2000 : 500;
		await new Promise( ( resolve ) => setTimeout( resolve, LOAD_TIMEOUT ) );

		return window.webContents.capturePage();
	};

	return { window, waitForCapture };
}
