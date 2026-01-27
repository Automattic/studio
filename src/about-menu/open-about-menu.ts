import { BrowserWindow, app } from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { ABOUT_WINDOW_HEIGHT, ABOUT_WINDOW_WIDTH } from 'src/constants';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getResourcesPath } from 'src/storage/paths';

let aboutWindow: BrowserWindow | null = null;

function getAboutPath(): string {
	return process.env.NODE_ENV === 'development'
		? path.join( getResourcesPath(), 'src/about-menu/about-menu.html' )
		: path.join( getResourcesPath(), 'dist/renderer/about-menu.html' );
}

export function escapeSingleQuotes( str: string ) {
	return str.replace( /\\/g, '\\\\' ).replace( /'/g, "\\'" );
}

function getPlatformLabel(): string {
	const platform = process.platform;
	const arch = process.arch;

	if ( platform === 'darwin' ) {
		return arch === 'arm64' ? __( 'Mac with Apple Silicon Chip' ) : __( 'Mac with Intel Chip' );
	}
	if ( platform === 'win32' ) {
		return arch === 'arm64' ? __( 'Windows on ARM' ) : __( 'Windows on Intel/AMD' );
	}
	return `${ platform } ${ arch }`;
}

export function openAboutWindow() {
	const aboutPath = getAboutPath();

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

	// Open external links in the default browser
	aboutWindow.webContents.setWindowOpenHandler( ( { url } ) => {
		void shellOpenExternalWrapper( url );

		return { action: 'deny' };
	} );

	// Read package.json and pass version to about window
	const packageJson = app.getVersion();

	aboutWindow.webContents.on( 'dom-ready', () => {
		if ( aboutWindow ) {
			//When updating these strings, make sure to update the corresponding strings in the about-menu.html file
			const versionText = escapeSingleQuotes( `${ packageJson } (${ getPlatformLabel() })` );
			const studioByWpcomText = escapeSingleQuotes( __( 'WordPress Studio' ) );
			const aboutStudioText = escapeSingleQuotes( __( 'About WordPress Studio' ) );
			const shareFeedbackText = escapeSingleQuotes( __( 'Share Feedback' ) );
			const releasesText = escapeSingleQuotes( __( 'Release Notes' ) );
			const demoSitesText = escapeSingleQuotes( __( 'Preview sites powered by' ) );
			const localSitesText = escapeSingleQuotes( __( 'Local sites powered by' ) );

			const script = `
				document.title = '${ aboutStudioText }';
				document.getElementById('studio-by-wpcom').innerText = '${ studioByWpcomText }';
				document.getElementById('version-text').innerText = '${ versionText }';
				document.getElementById('share-feedback').innerText = '${ shareFeedbackText }';
				document.getElementById('release-notes').innerText = '${ releasesText }';
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

	void aboutWindow.loadFile( aboutPath );
}
