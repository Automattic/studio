import { BrowserWindow, app, shell } from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { ABOUT_WINDOW_HEIGHT, ABOUT_WINDOW_WIDTH } from '../constants';

let aboutWindow: BrowserWindow | null = null;

export function openAboutWindow() {
	const aboutPath = path.join( __dirname, 'menu', 'about-menu.html' );

	if ( aboutWindow ) {
		aboutWindow.focus();
		return;
	}

	aboutWindow = new BrowserWindow( {
		width: ABOUT_WINDOW_WIDTH,
		height: ABOUT_WINDOW_HEIGHT,
		resizable: false,
		minimizable: false,
		maximizable: false,
		modal: true,
		webPreferences: {
			contextIsolation: true,
		},
	} );

	aboutWindow.loadFile( aboutPath );

	// Open external links in the default browser
	aboutWindow.webContents.setWindowOpenHandler( ( { url } ) => {
		shell.openExternal( url );
		return { action: 'deny' };
	} );

	// Read package.json and pass version to about window
	const packageJson = app.getVersion();

	aboutWindow.webContents.on( 'dom-ready', () => {
		if ( aboutWindow ) {
			// Inject version into the about window's HTML
			aboutWindow.webContents
				.executeJavaScript(
					`document.getElementById('version').innerText = '${ packageJson }'; 
					document.getElementById('studio-by-wpcom').innerText = '${ __( 'Studio by WordPress.com' ) }';
					document.getElementById('version-text').innerText = '${ __( 'Version' ) }'; 
					document.getElementById('share-feedback').innerText = '${ __( 'Share Feedback' ) }';
					document.getElementById('demo-sites').innerText = '${ __( 'Demo sites powered by' ) }';
					document.getElementById('local-sites').innerText = '${ __( 'Local sites powered by' ) }';`
				)
				.catch( ( err ) => {
					Sentry.captureException( err );
					console.error( 'Error executing JavaScript:', err );
				} );
		}
	} );

	aboutWindow.on( 'closed', () => {
		aboutWindow = null;
	} );
}
