import { BrowserWindow, app, shell } from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/renderer';
import { sprintf, __ } from '@wordpress/i18n';
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

	function escapeSingleQuotes( str: string ) {
		return str.replace( /'/g, "\\'" );
	}

	aboutWindow.webContents.on( 'dom-ready', () => {
		if ( aboutWindow ) {
			//When updating these strings, make sure to update the corresponding strings in the about-menu.html file
			const versionText = sprintf( __( 'Version %s' ), packageJson );
			const studioByWpcomText = escapeSingleQuotes( __( 'Studio by WordPress.com' ) );
			const shareFeedbackText = escapeSingleQuotes( __( 'Share Feedback' ) );
			const demoSitesText = escapeSingleQuotes( __( 'Demo sites powered by' ) );
			const localSitesText = escapeSingleQuotes( __( 'Local sites powered by' ) );

			const script = `
				document.getElementById('studio-by-wpcom').innerText = '${ studioByWpcomText }';
				document.getElementById('version-text').innerText = '${ versionText }';
				document.getElementById('share-feedback').innerText = '${ shareFeedbackText }';
				document.getElementById('demo-sites').innerText = '${ demoSitesText }';
				document.getElementById('local-sites').innerText = '${ localSitesText }';
			`;
			aboutWindow.webContents.executeJavaScript( script ).catch( ( err ) => {
				Sentry.captureException( err );
				console.error( 'Error executing JavaScript:', err );
			} );
		}
	} );
	aboutWindow.on( 'closed', () => {
		aboutWindow = null;
	} );
}
