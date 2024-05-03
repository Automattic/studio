import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { moveDatabasesInSitu } from '../vendor/wp-now/src';
import { MAIN_MIN_HEIGHT, MAIN_MIN_WIDTH, WINDOWS_TITLEBAR_HEIGHT } from './constants';
import { isEmptyDir } from './lib/fs-utils';
import { portFinder } from './lib/port-finder';
import { setupMenu } from './menu';
import { UserData } from './storage/storage-types';
import { loadUserData, saveUserData } from './storage/user-data';

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null;

function setupDevTools( mainWindow: BrowserWindow | null, devToolsOpen?: boolean ) {
	if ( devToolsOpen || ( process.env.NODE_ENV === 'development' && devToolsOpen === undefined ) ) {
		mainWindow?.webContents.openDevTools();
	}
}

function initializePortFinder( sites: SiteDetails[] ) {
	sites.forEach( ( site ) => {
		if ( site.port ) {
			portFinder.addUnavailablePort( site.port );
		}
	} );
}

async function removeSitesWithEmptyDirectories( userData: UserData ) {
	const sitesWithNonEmptyDirectories: SiteDetails[] = [];
	const storedSites = userData.sites || [];
	for ( const site of storedSites ) {
		if ( ! site.path ) {
			continue;
		}
		const directoryIsEmpty = await isEmptyDir( site.path );
		if ( ! directoryIsEmpty ) {
			sitesWithNonEmptyDirectories.push( site );
		}
	}
	saveUserData( { ...userData, sites: sitesWithNonEmptyDirectories } );
}

export function createMainWindow(): BrowserWindow {
	if ( mainWindow && ! mainWindow.isDestroyed() ) {
		return mainWindow;
	}

	mainWindow = new BrowserWindow( {
		height: MAIN_MIN_HEIGHT,
		width: MAIN_MIN_WIDTH,
		backgroundColor: 'rgba(30, 30, 30, 1)',
		minHeight: MAIN_MIN_HEIGHT,
		minWidth: MAIN_MIN_WIDTH,
		webPreferences: {
			preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
		},
		...getOSWindowOptions(),
	} );

	mainWindow.loadURL( MAIN_WINDOW_WEBPACK_ENTRY );

	// Open the DevTools if the user had it open last time they used the app.
	// During development the dev tools default to open.
	loadUserData().then( ( userData ) => {
		const { devToolsOpen, sites } = userData;
		setupDevTools( mainWindow, devToolsOpen );
		initializePortFinder( sites );
		removeSitesWithEmptyDirectories( userData );
		for ( const site of sites ) {
			moveDatabasesInSitu( site.path );
		}
	} );

	mainWindow.webContents.on( 'devtools-opened', async () => {
		const data = await loadUserData();
		data.devToolsOpen = true;
		await saveUserData( data );
	} );

	mainWindow.webContents.on( 'devtools-closed', async () => {
		const data = await loadUserData();
		data.devToolsOpen = false;
		await saveUserData( data );
	} );

	mainWindow.on( 'closed', () => {
		setupMenu( null );
		mainWindow = null;
	} );
	setupMenu( mainWindow );

	return mainWindow;
}

function getOSWindowOptions(): Partial< BrowserWindowConstructorOptions > {
	switch ( process.platform ) {
		case 'darwin':
			return {
				frame: false,
				titleBarStyle: 'hidden',
				trafficLightPosition: { x: 20, y: 20 },
			};

		case 'win32':
			return {
				titleBarStyle: 'hidden',
				titleBarOverlay: {
					color: 'rgba(30, 30, 30, 1)',
					symbolColor: 'white',
					height: WINDOWS_TITLEBAR_HEIGHT,
				},
			};

		default:
			return {};
	}
}

export function withMainWindow( callback: ( window: BrowserWindow ) => void ): void {
	if ( mainWindow && ! mainWindow.isDestroyed() ) {
		callback( mainWindow );
		return;
	}

	const windows = BrowserWindow.getAllWindows();
	if ( windows.length > 0 ) {
		mainWindow = BrowserWindow.getFocusedWindow() || windows[ 0 ];
		callback( mainWindow );
		return;
	}

	const newWindow = createMainWindow();
	mainWindow = newWindow;
	newWindow.webContents.on( 'did-finish-load', () => {
		callback( newWindow );
	} );
}

/**
 * Reset the main window reference. Exported for testing as resetting modules
 * with Jest while preserving manual Electron mocks proved quite difficult.
 */
export function __resetMainWindow() {
	mainWindow = null;
}
