import { BrowserWindow, app, shell } from 'electron';
import path from 'path';

let aboutWindow: BrowserWindow | null = null;

export function openAboutWindow() {
	const aboutPath = path.join( __dirname, 'menu', 'about-menu.html' );

	if ( aboutWindow ) {
		aboutWindow.focus();
		return;
	}

	aboutWindow = new BrowserWindow( {
		width: 284,
		height: 284,
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
		// Inject version into the about window's HTML
		aboutWindow?.webContents.executeJavaScript(
			`document.getElementById('version').innerText = '${ packageJson }'`
		);
	} );

	aboutWindow.on( 'closed', () => {
		aboutWindow = null;
	} );
}
