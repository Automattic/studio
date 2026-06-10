import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	Menu,
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
	MACOS_TRAFFIC_LIGHT_POSITION,
	MAIN_MIN_HEIGHT,
	MAIN_MIN_WIDTH,
	WINDOWS_TITLEBAR_HEIGHT,
} from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { removeMenu } from 'src/menu';
import { SiteServer } from 'src/site-server';
import {
	loadUserData,
	updateAppdata,
	loadWindowBounds,
	saveWindowBounds,
} from 'src/storage/user-data';
import type { StudioUiMode } from '@studio/common/types/desk';
import type { UserData, WindowBounds } from 'src/storage/storage-types';

let mainWindow: BrowserWindow | null;
let currentRendererUrl: string | undefined;

const OPAQUE_WINDOW_BACKGROUND = 'rgba(30, 30, 30, 1)';
const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';

interface RendererLocation {
	url: string;
	filePath?: string;
	query?: Record< string, string >;
}

export function getPreferredStudioUiMode(
	userData: Pick< UserData, 'betaFeatures' >
): StudioUiMode {
	if ( userData.betaFeatures?.desksUi ) {
		return 'desks';
	}
	if ( userData.betaFeatures?.agenticUi ) {
		return 'agentic';
	}
	return 'default';
}

function getRendererFilePath( mode: StudioUiMode ) {
	return path.join(
		__dirname,
		mode === 'default' ? '../renderer/index.html' : '../renderer-desks/index.html'
	);
}

function getRendererQuery( mode: StudioUiMode ): Record< string, string > | undefined {
	const query: Record< string, string > = mode === 'default' ? {} : { 'studio-ui-mode': mode };
	return Object.keys( query ).length ? query : undefined;
}

function appendRendererQuery( url: string, query: Record< string, string > | undefined ) {
	if ( ! query ) {
		return url;
	}

	const rendererUrl = new URL( url );
	for ( const [ key, value ] of Object.entries( query ) ) {
		rendererUrl.searchParams.set( key, value );
	}
	return rendererUrl.toString();
}

function getRendererLocation( preferredMode: StudioUiMode ): RendererLocation {
	const preferredQuery = getRendererQuery( preferredMode );

	if (
		! app.isPackaged &&
		preferredMode !== 'default' &&
		process.env[ 'ELECTRON_DESKS_RENDERER_URL' ]
	) {
		return {
			url: appendRendererQuery( process.env[ 'ELECTRON_DESKS_RENDERER_URL' ], preferredQuery ),
		};
	}

	if ( ! app.isPackaged && process.env[ 'ELECTRON_RENDERER_URL' ] ) {
		return {
			url: appendRendererQuery( process.env[ 'ELECTRON_RENDERER_URL' ], preferredQuery ),
		};
	}

	let mode = preferredMode;
	let filePath = getRendererFilePath( mode );
	if ( mode !== 'default' && ! fs.existsSync( filePath ) ) {
		mode = 'default';
		filePath = getRendererFilePath( mode );
	}
	const query = getRendererQuery( mode );

	return {
		filePath,
		query,
		url: appendRendererQuery( pathToFileURL( filePath ).href, query ),
	};
}

function rememberRendererLocation( location: RendererLocation ) {
	currentRendererUrl = location.url;
}

async function loadRendererLocation( window: BrowserWindow, location: RendererLocation ) {
	rememberRendererLocation( location );
	if ( location.filePath ) {
		await window.loadFile(
			location.filePath,
			location.query ? { query: location.query } : undefined
		);
		return;
	}
	await window.loadURL( location.url );
}

export async function loadMainWindowRenderer(
	window: BrowserWindow,
	mode?: StudioUiMode
): Promise< void > {
	const resolvedMode = mode ?? getPreferredStudioUiMode( await loadUserData() );
	await loadRendererLocation( window, getRendererLocation( resolvedMode ) );
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

	const userData = await loadUserData();
	nativeTheme.themeSource = userData.colorScheme ?? 'light';

	const savedBounds = await loadWindowBounds();
	let windowOptions: BrowserWindowConstructorOptions = {
		height: DEFAULT_HEIGHT,
		width: DEFAULT_WIDTH,
		backgroundColor: OPAQUE_WINDOW_BACKGROUND,
		minHeight: MAIN_MIN_HEIGHT,
		minWidth: MAIN_MIN_WIDTH,
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

	// Restore fullscreen state if it was saved
	if ( savedBounds?.isFullScreen ) {
		mainWindow.setFullScreen( true );
	}

	void loadRendererLocation(
		mainWindow,
		getRendererLocation( getPreferredStudioUiMode( userData ) )
	);

	// Open the DevTools if the user had it open last time they used the app.
	// During development the dev tools default to open.
	void loadUserData().then( ( userData ) => {
		setupDevTools( mainWindow, userData.devToolsOpen );
		initializePortFinder( SiteServer.getAllDetails() );
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

	// Cmd/Ctrl +/-/0 zoom. The classic shell gets these from the application
	// menu's zoom roles (see menu.ts); the apps/ui shell never builds that
	// menu, so the accelerators are dead there. Wire them at the webContents
	// level, but defer to the application menu when one is present so the
	// classic shell doesn't zoom twice per keypress.
	mainWindow.webContents.on( 'before-input-event', ( event, input ) => {
		if ( input.type !== 'keyDown' || ! ( input.meta || input.control ) ) {
			return;
		}
		if ( Menu.getApplicationMenu() ) {
			return;
		}
		const contents = mainWindow?.webContents;
		if ( ! contents ) {
			return;
		}
		const ZOOM_STEP = 0.5;
		const ZOOM_MIN = -3;
		const ZOOM_MAX = 5;
		if ( input.key === '=' || input.key === '+' ) {
			event.preventDefault();
			contents.setZoomLevel( Math.min( ZOOM_MAX, contents.getZoomLevel() + ZOOM_STEP ) );
		} else if ( input.key === '-' || input.key === '_' ) {
			event.preventDefault();
			contents.setZoomLevel( Math.max( ZOOM_MIN, contents.getZoomLevel() - ZOOM_STEP ) );
		} else if ( input.key === '0' ) {
			event.preventDefault();
			contents.setZoomLevel( 0 );
		}
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
				backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
				frame: false,
				transparent: true,
				titleBarStyle: 'hidden',
				trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
				vibrancy: 'sidebar',
				visualEffectState: 'active',
			};

		case 'win32':
			return {
				backgroundMaterial: 'acrylic',
				titleBarStyle: 'hidden',
				titleBarOverlay: {
					color: OPAQUE_WINDOW_BACKGROUND,
					symbolColor: 'white',
					height: WINDOWS_TITLEBAR_HEIGHT,
				},
				minHeight: MAIN_MIN_HEIGHT + WINDOWS_TITLEBAR_HEIGHT,
			};

		case 'linux':
			return {
				titleBarStyle: 'hidden',
				titleBarOverlay: {
					color: OPAQUE_WINDOW_BACKGROUND,
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
