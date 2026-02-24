import { BrowserWindow, type BrowserWindowConstructorOptions, screen, app, nativeTheme } from 'electron';
import * as path from 'path';
import { portFinder } from '@studio/common/lib/port-finder';
import {
	DEFAULT_WIDTH,
	MACOS_TRAFFIC_LIGHT_POSITION,
	MAIN_MIN_HEIGHT,
	MAIN_MIN_WIDTH,
	WINDOWS_TITLEBAR_HEIGHT,
} from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { removeMenu } from 'src/menu';
import {
	loadUserData,
	updateAppdata,
	loadWindowBounds,
	saveWindowBounds,
} from 'src/storage/user-data';
import type { WindowBounds } from 'src/storage/storage-types';

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

function isValidWindowBounds( bounds: WindowBounds ): boolean {
	if ( bounds.width < MAIN_MIN_WIDTH || bounds.height < MAIN_MIN_HEIGHT ) {
		return false;
	}

	const displays = screen.getAllDisplays();
	return displays.some( ( display ) => {
		const { x, y, width, height } = display.workArea;
		return (
			bounds.x >= x - 100 &&
			bounds.y >= y - 100 &&
			bounds.x + bounds.width <= x + width + 100 &&
			bounds.y + bounds.height <= y + height + 100
		);
	} );
}

export async function createMainWindow(): Promise< BrowserWindow > {
	if ( mainWindow && ! mainWindow.isDestroyed() ) {
		return mainWindow;
	}

	nativeTheme.themeSource = 'system';

	const savedBounds = await loadWindowBounds();
	let windowOptions: BrowserWindowConstructorOptions = {
		height: MAIN_MIN_HEIGHT,
		width: DEFAULT_WIDTH,
		backgroundColor: 'rgba(30, 30, 30, 1)',
		minHeight: MAIN_MIN_HEIGHT,
		minWidth: MAIN_MIN_WIDTH,
		webPreferences: {
			preload: path.join( __dirname, '../preload/preload.js' ),
			webSecurity: process.env.NODE_ENV !== 'development',
		},
		...getOSWindowOptions(),
	};

	if ( savedBounds && isValidWindowBounds( savedBounds ) ) {
		windowOptions = {
			...windowOptions,
			x: savedBounds.x,
			y: savedBounds.y,
			width: savedBounds.width,
			height: savedBounds.height,
		};
	}

	mainWindow = new BrowserWindow( windowOptions );

	// Restore fullscreen state if it was saved
	if ( savedBounds?.isFullScreen ) {
		mainWindow.setFullScreen( true );
	}

	if ( ! app.isPackaged && process.env[ 'ELECTRON_RENDERER_URL' ] ) {
		void mainWindow.loadURL( process.env[ 'ELECTRON_RENDERER_URL' ] );
	} else {
		void mainWindow.loadFile( path.join( __dirname, '../renderer/index.html' ) );
	}

	// Open the DevTools if the user had it open last time they used the app.
	// During development the dev tools default to open.
	void loadUserData().then( ( userData ) => {
		const { devToolsOpen, sites } = userData;
		setupDevTools( mainWindow, devToolsOpen );
		initializePortFinder( sites );
	} );

	mainWindow.webContents.on( 'devtools-opened', async () => {
		await updateAppdata( { devToolsOpen: true } );
	} );

	mainWindow.webContents.on( 'devtools-closed', async () => {
		await updateAppdata( { devToolsOpen: false } );
	} );

	mainWindow.webContents.once( 'did-finish-load', () => {
		void promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: true } );
	} );

	mainWindow.on( 'closed', () => {
		removeMenu();
		mainWindow = null;
	} );

	mainWindow.on( 'enter-full-screen', () => {
		sendIpcEventToRendererWithWindow( mainWindow, 'window-fullscreen-change', true );
		// Save fullscreen state
		if ( mainWindow && ! mainWindow.isDestroyed() ) {
			const bounds = mainWindow.getBounds();
			void saveWindowBounds( { ...bounds, isFullScreen: true } );
		}
	} );

	mainWindow.on( 'leave-full-screen', () => {
		sendIpcEventToRendererWithWindow( mainWindow, 'window-fullscreen-change', false );
		// Save bounds after leaving fullscreen
		if ( mainWindow && ! mainWindow.isDestroyed() ) {
			const bounds = mainWindow.getBounds();
			void saveWindowBounds( { ...bounds, isFullScreen: false } );
		}
	} );

	let saveTimeout: NodeJS.Timeout | null = null;
	const saveBounds = () => {
		if ( saveTimeout ) {
			clearTimeout( saveTimeout );
		}
		saveTimeout = setTimeout( () => {
			if ( mainWindow && ! mainWindow.isDestroyed() && ! mainWindow.isFullScreen() ) {
				const bounds = mainWindow.getBounds();
				void saveWindowBounds( { ...bounds, isFullScreen: false } );
			}
		}, 100 );
	};

	mainWindow.on( 'moved', saveBounds );
	mainWindow.on( 'resized', saveBounds );

	return mainWindow;
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
					color: 'rgba(30, 30, 30, 1)',
					symbolColor: 'white',
					height: WINDOWS_TITLEBAR_HEIGHT,
				},
				minHeight: MAIN_MIN_HEIGHT + WINDOWS_TITLEBAR_HEIGHT,
			};

		default:
			return {};
	}
}

export function getMainWindow() {
	return new Promise< BrowserWindow >( ( resolve ) => {
		if ( mainWindow && ! mainWindow.isDestroyed() && ! mainWindow.webContents.isDestroyed() ) {
			resolve( mainWindow );
			return;
		}

		const windows = BrowserWindow.getAllWindows();
		if ( windows.length > 0 ) {
			mainWindow = BrowserWindow.getFocusedWindow() || windows[ 0 ];
			if ( ! mainWindow.webContents.isDestroyed() ) {
				resolve( mainWindow );
			}
			return;
		}

		createMainWindow()
			.then( ( newWindow ) => {
				mainWindow = newWindow;
				newWindow.webContents.on( 'did-finish-load', () => {
					resolve( newWindow );
				} );
			} )
			.catch( ( error ) => {
				console.error( 'Failed to create main window:', error );
			} );
	} );
}

/**
 * Reset the main window reference. Exported for testing as resetting modules
 * with Vitest while preserving manual Electron mocks proved quite difficult.
 */
export function __resetMainWindow() {
	mainWindow = null;
}
