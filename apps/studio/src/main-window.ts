import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	screen,
	app,
	nativeTheme,
} from 'electron';
import fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { portFinder } from '@studio/common/lib/port-finder';
import {
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	AGENTIC_MIN_WIDTH,
	MACOS_TRAFFIC_LIGHT_POSITION,
	MAIN_MIN_HEIGHT,
	MAIN_MIN_WIDTH,
	WINDOWS_TITLEBAR_HEIGHT,
} from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { getPreferredStudioUiMode, type StudioUiMode } from 'src/lib/studio-ui-mode';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { removeMenu } from 'src/menu';
import { SiteServer } from 'src/site-server';
import {
	loadUserData,
	updateAppdata,
	loadWindowBounds,
	saveWindowBounds,
} from 'src/storage/user-data';
import type { WindowBounds } from 'src/storage/storage-types';

let mainWindow: BrowserWindow | null;
let currentRendererUrl: string | undefined;

interface RendererLocation {
	url: string;
	filePath?: string;
}

function getRendererFilePath( mode: StudioUiMode ) {
	return path.join(
		__dirname,
		mode === 'default' ? '../renderer/index.html' : '../renderer-ui/index.html'
	);
}

function getRendererLocation( preferredMode: StudioUiMode ): RendererLocation {
	if (
		! app.isPackaged &&
		preferredMode === 'agentic' &&
		process.env[ 'ELECTRON_UI_RENDERER_URL' ]
	) {
		return {
			url: process.env[ 'ELECTRON_UI_RENDERER_URL' ],
		};
	}

	if ( ! app.isPackaged && process.env[ 'ELECTRON_RENDERER_URL' ] ) {
		return {
			url: process.env[ 'ELECTRON_RENDERER_URL' ],
		};
	}

	let mode = preferredMode;
	let filePath = getRendererFilePath( mode );
	if ( mode !== 'default' && ! fs.existsSync( filePath ) ) {
		mode = 'default';
		filePath = getRendererFilePath( mode );
	}

	return {
		filePath,
		url: pathToFileURL( filePath ).href,
	};
}

function rememberRendererLocation( location: RendererLocation ) {
	currentRendererUrl = location.url;
}

async function loadRendererLocation( window: BrowserWindow, location: RendererLocation ) {
	rememberRendererLocation( location );
	if ( location.filePath ) {
		await window.loadFile( location.filePath );
		return;
	}
	await window.loadURL( location.url );
}

export async function loadMainWindowRenderer( window: BrowserWindow ): Promise< void > {
	await loadRendererLocation( window, getRendererLocation( getPreferredStudioUiMode() ) );
	// Switching renderers changes the floor. Growing it (agentic → default)
	// also widens a window that is already below the new minimum.
	const minWidth = getMinWindowWidth();
	window.setMinimumSize( minWidth, MAIN_MIN_HEIGHT );
	const [ width, height ] = window.getSize();
	if ( width < minWidth ) {
		window.setSize( minWidth, height, true );
	}
	if ( process.platform === 'win32' || process.platform === 'linux' ) {
		window.setTitleBarOverlay( getTitleBarOverlayOptions() );
	}
}

export function getCurrentRendererUrl(): string {
	if ( currentRendererUrl ) {
		return currentRendererUrl;
	}

	return getRendererLocation( 'default' ).url;
}

function setupDevTools( mainWindow: BrowserWindow | null, devToolsOpen?: boolean ) {
	if ( devToolsOpen || ( process.env.NODE_ENV === 'development' && devToolsOpen === undefined ) ) {
		mainWindow?.webContents.openDevTools();
	}
}

export function isToggleSidebarShortcut(
	input: Electron.Input,
	platform: NodeJS.Platform = process.platform
): boolean {
	if (
		input.type !== 'keyDown' ||
		input.isAutoRepeat ||
		input.isComposing ||
		input.shift ||
		input.alt ||
		input.key.toLowerCase() !== 'b'
	) {
		return false;
	}

	if ( platform === 'darwin' ) {
		return input.meta && ! input.control;
	}

	return input.control && ! input.meta;
}

function initializePortFinder( sites: SiteDetails[] ) {
	sites.forEach( ( site ) => {
		if ( site.port ) {
			portFinder.addUnavailablePort( site.port );
		}
	} );
}

// Each renderer has its own floor, so the window can't be dragged narrower
// than whichever one is on screen.
function getMinWindowWidth(): number {
	return getPreferredStudioUiMode() === 'agentic' ? AGENTIC_MIN_WIDTH : MAIN_MIN_WIDTH;
}

function isValidWindowBounds( bounds: WindowBounds ): boolean {
	if ( bounds.width < getMinWindowWidth() || bounds.height < MAIN_MIN_HEIGHT ) {
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

	const userData = await loadUserData();
	nativeTheme.themeSource = userData.colorScheme ?? 'light';

	const savedBounds = await loadWindowBounds();
	let windowOptions: BrowserWindowConstructorOptions = {
		height: DEFAULT_HEIGHT,
		width: DEFAULT_WIDTH,
		backgroundColor: 'rgba(30, 30, 30, 1)',
		minHeight: MAIN_MIN_HEIGHT,
		minWidth: getMinWindowWidth(),
		webPreferences: {
			preload: path.join( __dirname, '../preload/preload.js' ),
			webSecurity: process.env.NODE_ENV !== 'development',
			// Enables the `<webview>` tag used by the site-preview surface to
			// host running WordPress sites.
			webviewTag: true,
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

	if ( process.platform === 'win32' || process.platform === 'linux' ) {
		const updateTitleBarOverlay = () => {
			if ( mainWindow && ! mainWindow.isDestroyed() ) {
				mainWindow.setTitleBarOverlay( getTitleBarOverlayOptions() );
			}
		};
		nativeTheme.on( 'updated', updateTitleBarOverlay );
		mainWindow.on( 'closed', () => nativeTheme.removeListener( 'updated', updateTitleBarOverlay ) );
	}

	mainWindow.webContents.on( 'before-input-event', ( event, input ) => {
		if ( isToggleSidebarShortcut( input ) ) {
			event.preventDefault();
			sendIpcEventToRendererWithWindow( mainWindow, 'toggle-sidebar' );
		}
	} );

	// Restore fullscreen state if it was saved
	if ( savedBounds?.isFullScreen ) {
		mainWindow.setFullScreen( true );
	}

	const rendererLoaded = loadRendererLocation(
		mainWindow,
		getRendererLocation( getPreferredStudioUiMode() )
	);

	// DO NOT COMMIT — local fix for STU-2171, kept out of the STU-2162 branch.
	// It belongs in its own PR; drop it from any commit made here.
	//
	// Open the DevTools if the user had it open last time they used the app.
	// During development the dev tools default to open.
	//
	// This waits for the renderer to finish loading. Electron 43 delivers the
	// sandboxed preload's startup data as part of the initial page load;
	// attaching DevTools while that is still in flight leaves
	// `binding.startupData` null, so the preload never runs and the renderer
	// comes up with no `window.ipcApi` — a blank window whose only symptom is
	// an "IPC API not available" error.
	void loadUserData().then( ( userData ) => {
		initializePortFinder( SiteServer.getAllDetails() );
		void rendererLoaded.then( () => setupDevTools( mainWindow, userData.devToolsOpen ) );
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

// Matches the renderer's `--color-frame-bg`, so window controls blend into a fullscreen modal.
export function getFrameTitleBarOverlayOptions() {
	const isDark = nativeTheme.shouldUseDarkColors;
	return {
		color: isDark ? '#2f2f2f' : '#fff',
		symbolColor: isDark ? '#e0e0e0' : '#1e1e1e',
		height: WINDOWS_TITLEBAR_HEIGHT,
	};
}

export function getTitleBarOverlayOptions() {
	if ( getPreferredStudioUiMode() !== 'agentic' ) {
		return { color: 'rgba(30, 30, 30, 1)', symbolColor: 'white', height: WINDOWS_TITLEBAR_HEIGHT };
	}
	const isDark = nativeTheme.shouldUseDarkColors;
	return {
		color: isDark ? '#242424' : '#fff',
		symbolColor: isDark ? '#e0e0e0' : '#1e1e1e',
		height: WINDOWS_TITLEBAR_HEIGHT,
	};
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
		case 'linux':
			return {
				titleBarStyle: 'hidden',
				titleBarOverlay: getTitleBarOverlayOptions(),
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
