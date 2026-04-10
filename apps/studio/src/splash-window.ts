import { BrowserWindow } from 'electron';
import path from 'path';

let splashWindow: BrowserWindow | null = null;

export function createSplashWindow(): void {
	splashWindow = new BrowserWindow( {
		width: 380,
		height: 280,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		resizable: false,
		skipTaskbar: true,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
		},
	} );

	const splashPath =
		process.env.NODE_ENV === 'development'
			? path.join( __dirname, '../../src/about-menu/splash.html' )
			: path.join( __dirname, '../renderer/splash.html' );

	void splashWindow.loadFile( splashPath );

	splashWindow.once( 'closed', () => {
		splashWindow = null;
	} );
}

export function destroySplashWindow(): void {
	if ( splashWindow && ! splashWindow.isDestroyed() ) {
		splashWindow.close();
	}
}
