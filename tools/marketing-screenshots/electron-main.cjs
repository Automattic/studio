const path = require( 'node:path' );
const { app, BrowserWindow, ipcMain, nativeTheme, screen, webContents } = require( 'electron' );

const captureUrl = process.env.STUDIO_MARKETING_CAPTURE_URL;
const width = Number.parseInt( process.env.STUDIO_MARKETING_CAPTURE_WIDTH || '1440', 10 );
const height = Number.parseInt( process.env.STUDIO_MARKETING_CAPTURE_HEIGHT || '900', 10 );
const captureScale = process.env.STUDIO_MARKETING_CAPTURE_SCALE || '2';
const theme = process.env.STUDIO_MARKETING_CAPTURE_THEME || 'light';

if ( ! captureUrl ) {
	throw new Error( 'STUDIO_MARKETING_CAPTURE_URL is required.' );
}

const captureUserData = process.env.STUDIO_MARKETING_CAPTURE_USER_DATA;
if ( ! captureUserData ) {
	throw new Error( 'STUDIO_MARKETING_CAPTURE_USER_DATA is required.' );
}
app.setPath( 'userData', captureUserData );

app.commandLine.appendSwitch( 'disable-renderer-backgrounding' );

ipcMain.handle( 'setWebviewViewport', async ( event, webContentsId, viewport ) => {
	const target = webContents.fromId( webContentsId );
	if (
		! target ||
		target.getType() !== 'webview' ||
		target.hostWebContents?.id !== event.sender.id
	) {
		throw new Error( 'Preview webview is unavailable.' );
	}
	if ( ! target.debugger.isAttached() ) {
		target.debugger.attach( '1.3' );
	}
	if ( ! viewport ) {
		await target.debugger.sendCommand( 'Emulation.clearDeviceMetricsOverride' );
		return;
	}
	const { width: viewportWidth, height: viewportHeight, scale, mobile } = viewport;
	const isValidDimension = ( value ) => Number.isInteger( value ) && value > 0 && value <= 10000;
	if (
		! isValidDimension( viewportWidth ) ||
		! isValidDimension( viewportHeight ) ||
		! Number.isFinite( scale ) ||
		scale <= 0 ||
		scale > 1
	) {
		throw new Error( 'Unsupported webview viewport.' );
	}
	await target.debugger.sendCommand( 'Emulation.setDeviceMetricsOverride', {
		width: viewportWidth,
		height: viewportHeight,
		deviceScaleFactor: 0,
		mobile: mobile === true,
		scale,
	} );
} );

app.whenReady().then( async () => {
	nativeTheme.themeSource = theme;
	const windowOptions = {
		width,
		height,
		useContentSize: true,
		show: false,
		backgroundColor: '#1e1e1e',
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join( __dirname, 'electron-preload.cjs' ),
			webSecurity: true,
			webviewTag: true,
		},
	};

	if ( process.platform === 'darwin' ) {
		windowOptions.frame = false;
		windowOptions.titleBarStyle = 'hidden';
		windowOptions.trafficLightPosition = { x: 20, y: 20 };
	} else {
		windowOptions.titleBarStyle = 'hidden';
		windowOptions.titleBarOverlay = { height: 44 };
	}

	const mainWindow = new BrowserWindow( windowOptions );
	const displayScale = screen.getDisplayMatching( mainWindow.getBounds() ).scaleFactor;
	if ( displayScale !== Number( captureScale ) ) {
		throw new Error(
			`Capture preset requires a ${ captureScale }x display, but Electron is running at ${ displayScale }x.`
		);
	}
	mainWindow.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) );
	mainWindow.webContents.on( 'will-attach-webview', ( event, webPreferences ) => {
		delete webPreferences.preload;
		webPreferences.nodeIntegration = false;
		webPreferences.contextIsolation = true;
		webPreferences.sandbox = true;
	} );
	mainWindow.webContents.on( 'did-attach-webview', ( event, guest ) => {
		guest.setZoomFactor( 1 );
	} );
	await mainWindow.loadURL( captureUrl );
	mainWindow.show();
} );

app.on( 'window-all-closed', () => app.quit() );
