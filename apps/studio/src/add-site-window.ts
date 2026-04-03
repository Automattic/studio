import { BrowserWindow, type BrowserWindowConstructorOptions, nativeTheme } from 'electron';
import { MACOS_TRAFFIC_LIGHT_POSITION, WINDOWS_TITLEBAR_HEIGHT } from 'src/constants';

const CHROME_BG_LIGHT = '#e0e0e0';
const CHROME_BG_DARK = '#1a1a1a';

let addSiteWindow: BrowserWindow | null = null;

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

export function openAddSiteWindow( preloadPath: string, rendererUrl?: string ) {
	const search = 'view=add-site';

	if ( addSiteWindow && ! addSiteWindow.isDestroyed() ) {
		addSiteWindow.focus();
		return;
	}

	addSiteWindow = new BrowserWindow( {
		width: 900,
		height: 600,
		minWidth: 700,
		minHeight: 500,
		backgroundColor: getChromeBg(),
		webPreferences: {
			preload: preloadPath,
			webSecurity: process.env.NODE_ENV !== 'development',
		},
		...getOSWindowOptions(),
	} );

	if ( rendererUrl ) {
		void addSiteWindow.loadURL( `${ rendererUrl }?${ search }` );
	} else {
		const path = require( 'path' );
		void addSiteWindow.loadFile(
			path.join( path.dirname( preloadPath ), '../renderer/index.html' ),
			{ search }
		);
	}

	addSiteWindow.on( 'closed', () => {
		addSiteWindow = null;
	} );
}

export function closeAddSiteWindow() {
	if ( addSiteWindow && ! addSiteWindow.isDestroyed() ) {
		addSiteWindow.close();
	}
}
