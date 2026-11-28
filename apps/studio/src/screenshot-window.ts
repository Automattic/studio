import crypto from 'crypto';
import { BrowserWindow, session } from 'electron';
import { SITE_THUMBNAIL_VIEWPORT } from '@studio/common/constants';

export function createScreenshotWindow( captureUrl: string ) {
	const newSession = session.fromPartition( crypto.randomUUID() );

	// Accept unsafe HTTPS certificates
	newSession.setCertificateVerifyProc( ( request, callback ) => {
		callback( 0 );
	} );

	const window = new BrowserWindow( {
		...SITE_THUMBNAIL_VIEWPORT,
		useContentSize: true,
		frame: false,
		show: false,
		webPreferences: { session: newSession },
	} );

	const waitForCapture = async () => {
		let mainFrameStatusCode: number = 0;

		window.webContents.on( 'did-navigate', ( event, url, httpResponseCode ) => {
			mainFrameStatusCode = httpResponseCode;
		} );

		await window.loadURL( captureUrl );

		if ( mainFrameStatusCode >= 500 ) {
			throw new Error( `Failed to load screenshot URL with status ${ mainFrameStatusCode }` );
		}

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
			html {
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

		window.setContentSize( SITE_THUMBNAIL_VIEWPORT.width, SITE_THUMBNAIL_VIEWPORT.height );
		return await window.webContents.capturePage();
	};

	return { window, waitForCapture };
}
