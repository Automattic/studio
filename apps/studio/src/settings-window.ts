import { BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';
import { MACOS_TRAFFIC_LIGHT_POSITION, WINDOWS_TITLEBAR_HEIGHT } from 'src/constants';

const CHROME_BG_LIGHT = '#e0e0e0';
const CHROME_BG_DARK = '#1a1a1a';

const SETTINGS_WIDTH = 600;
const SETTINGS_HEIGHT = 500;

let settingsWindow: BrowserWindow | null = null;

function getChromeBg() {
	return nativeTheme.shouldUseDarkColors ? CHROME_BG_DARK : CHROME_BG_LIGHT;
}

function getOSWindowOptions(): Partial< BrowserWindowConstructorOptions > {
	switch ( process.platform ) {
		case 'darwin':
			return {
				frame: false,
				titleBarStyle: 'hidden',
				trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
			};

		case 'win32':
			return {
				titleBarStyle: 'hidden',
				titleBarOverlay: {
					color: getChromeBg(),
					symbolColor: nativeTheme.shouldUseDarkColors ? 'white' : 'black',
					height: WINDOWS_TITLEBAR_HEIGHT,
				},
			};

		default:
			return {};
	}
}

export function openSettingsWindow( preloadPath: string, rendererUrl?: string ) {
	if ( settingsWindow && ! settingsWindow.isDestroyed() ) {
		settingsWindow.focus();
		return;
	}

	settingsWindow = new BrowserWindow( {
		width: SETTINGS_WIDTH,
		height: SETTINGS_HEIGHT,
		minWidth: 400,
		minHeight: 300,
		backgroundColor: getChromeBg(),
		webPreferences: {
			preload: preloadPath,
			webSecurity: process.env.NODE_ENV !== 'development',
		},
		...getOSWindowOptions(),
	} );

	if ( rendererUrl ) {
		void settingsWindow.loadURL( `${ rendererUrl }?view=settings` );
	} else {
		// Production: load from built files relative to the preload path
		const path = require( 'path' );
		void settingsWindow.loadFile(
			path.join( path.dirname( preloadPath ), '../renderer/index.html' ),
			{
				search: 'view=settings',
			}
		);
	}

	settingsWindow.on( 'closed', () => {
		settingsWindow = null;
	} );
}
