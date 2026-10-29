import {
	Menu,
	type MenuItemConstructorOptions,
	BrowserWindow,
	autoUpdater,
	shell,
	type WebContents,
} from 'electron';
import { getLocalizedLink } from '@studio/common/lib/docs-links';
import {
	getAppConfigPath,
	getCliConfigPath,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from 'src/about-menu/open-about-menu';
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { applyAppZoomCommand } from 'src/lib/app-zoom';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow } from 'src/main-window';
import { isUpdateReadyToInstall, manualCheckForUpdates } from 'src/updates';

// Runs against the app window's own contents rather than whatever has focus.
async function withAppWebContents( run: ( contents: WebContents ) => void ) {
	const window = await getMainWindow();
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		run( window.webContents );
	}
}

export async function setupMenu() {
	const mainWindow = await getMainWindow();
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}
	const menu = await getAppMenu( mainWindow );
	if ( process.platform === 'darwin' ) {
		Menu.setApplicationMenu( menu );
		return;
	}
	// Make menu accessible in development for non-macOS platforms
	if ( process.env.NODE_ENV === 'development' ) {
		mainWindow?.setMenu( menu );
		return;
	}
	Menu.setApplicationMenu( null );
}

export function removeMenu() {
	Menu.setApplicationMenu( null );
}

export async function popupMenu( position?: { x: number; y: number } ) {
	const window = await getMainWindow();
	const menu = await getAppMenu( window );
	menu.popup( { window: window ?? undefined, ...position } );
}

export function buildViewMenuItems( {
	isDevelopment,
	isAlwaysOnTop,
	devTools,
	onToggleSidebar,
	onToggleSitePreview,
	onResetZoom,
	onZoomIn,
	onZoomOut,
}: {
	isDevelopment: boolean;
	isAlwaysOnTop?: boolean;
	devTools: MenuItemConstructorOptions[];
	onToggleSidebar: () => void;
	onToggleSitePreview: () => void;
	onResetZoom: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
} ): MenuItemConstructorOptions[] {
	return [
		{
			label: __( 'Toggle Sidebar' ),
			accelerator: 'CommandOrControl+B',
			click: onToggleSidebar,
		},
		{
			label: __( 'Toggle Site Preview' ),
			accelerator: 'CommandOrControl+Shift+B',
			click: onToggleSitePreview,
		},
		...( isDevelopment ? devTools : [] ),
		{
			label: __( 'Actual Size' ),
			accelerator: 'CommandOrControl+0',
			click: onResetZoom,
		},
		{
			label: __( 'Zoom In' ),
			accelerator: 'CommandOrControl+Plus',
			click: onZoomIn,
		},
		{
			label: __( 'Zoom Out' ),
			accelerator: 'CommandOrControl+-',
			click: onZoomOut,
		},
		{ type: 'separator' },
		{
			label: __( 'Toggle Fullscreen' ),
			...( process.platform === 'darwin'
				? ( {
						// The native role can cause macOS to insert a second fullscreen item.
						accelerator: 'Control+Command+F',
						click: ( _menuItem, browserWindow ) => {
							browserWindow?.setFullScreen( ! browserWindow.isFullScreen() );
						},
				  } satisfies MenuItemConstructorOptions )
				: { role: 'togglefullscreen' as const } ),
		},
		{ type: 'separator' },
		{
			label: __( 'Float on Top of All Other Windows' ),
			type: 'checkbox',
			checked: isAlwaysOnTop,
			click: ( _menuItem, browserWindow ) => {
				if ( browserWindow ) {
					browserWindow.setAlwaysOnTop( ! browserWindow.isAlwaysOnTop(), 'floating' );
				}
			},
		},
	];
}

async function getAppMenu( mainWindow: BrowserWindow | null ) {
	const crashTestMenuItems: MenuItemConstructorOptions[] = [
		{
			label: __( 'Test Hard Crash (dev only)' ),
			click: () => {
				process.crash();
			},
		},
	];

	// Cmd/Ctrl+R belongs to the site preview: the renderer binds it in the DOM
	// to reload the guest page, so the menu must leave the key alone — a menu
	// accelerator would consume it first. That leaves the app itself with no way
	// to reload, so these target the app window explicitly rather than using
	// `role: 'reload'`, which acts on whatever webContents has focus (the
	// preview, once clicked into).
	const devTools: MenuItemConstructorOptions[] = [
		{
			label: __( 'Reload App' ),
			click: () => void withAppWebContents( ( contents ) => contents.reload() ),
		},
		{
			label: __( 'Force Reload App' ),
			accelerator: 'CommandOrControl+Shift+R',
			click: () => void withAppWebContents( ( contents ) => contents.reloadIgnoringCache() ),
		},
		{
			label: __( 'Toggle DevTools' ),
			accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Control+Shift+I',
			click: () => void withAppWebContents( ( contents ) => contents.toggleDevTools() ),
		},
		{ type: 'separator' },
	];

	return Menu.buildFromTemplate( [
		{
			label: 'WordPress Studio', // macOS ignores this name and uses the name from the .plist
			role: 'appMenu',
			submenu: [
				{
					label: __( 'About WordPress Studio' ),
					click: openAboutWindow,
				},
				...( isUpdateReadyToInstall()
					? [
							{
								label: __( 'Restart to Apply Updates' ),
								click: () => autoUpdater.quitAndInstall(),
							},
					  ]
					: [ { label: __( 'Check for Updates' ), click: manualCheckForUpdates } ] ),
				{ type: 'separator' },
				{
					label: __( 'Settings…' ),
					accelerator: 'CommandOrControl+,',
					click: async () => {
						void sendIpcEventToRenderer( 'user-settings', { tabName: 'general' } );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { label: __( 'Services' ), role: 'services' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { label: __( 'Hide' ), role: 'hide' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.env.NODE_ENV === 'development' ? crashTestMenuItems : [] ),
				...( process.env.NODE_ENV === 'development'
					? [
							{
								label: __( 'Open Config Files (dev only)' ),
								submenu: [
									{
										label: __( 'App Config (app.json)' ),
										click: async () => {
											const configPath = getAppConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
									{
										label: __( 'Shared Config (shared.json)' ),
										click: async () => {
											const configPath = getSharedConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
									{
										label: __( 'CLI Config (cli.json)' ),
										click: async () => {
											const configPath = getCliConfigPath();
											const err = await shell.openPath( configPath );
											if ( err ) {
												console.error( `Error opening config file: ${ configPath } ${ err }` );
											}
										},
									},
								],
							},
					  ]
					: [] ),
				{ type: 'separator' },
				{ label: __( 'Quit' ), role: 'quit' },
			],
		},
		{
			label: __( 'File' ),
			role: 'fileMenu',
			submenu: [
				{
					label: __( 'Add Site…' ),
					accelerator: 'CommandOrControl+N',
					click: async () => {
						void sendIpcEventToRenderer( 'add-site' );
					},
				},
				...( process.platform === 'win32'
					? []
					: [
							{
								label: __( 'Close Window' ),
								accelerator: 'CommandOrControl+W',
								click: ( _menuItem, browserWindow ) => {
									browserWindow?.close();
								},
								enabled: !! mainWindow && ! mainWindow.isDestroyed(),
							} as MenuItemConstructorOptions,
					  ] ),
			],
		},
		{
			label: __( 'Edit' ),
			role: 'editMenu',
			submenu: [
				{
					label: __( 'Undo' ),
					role: 'undo',
				},
				{
					label: __( 'Redo' ),
					role: 'redo',
				},
				{ type: 'separator' },
				{ label: __( 'Cut' ), role: 'cut' },
				{ label: __( 'Copy' ), role: 'copy' },
				{ label: __( 'Paste' ), role: 'paste' },
				{
					label: __( 'Paste and Match Style' ),
					role: 'pasteAndMatchStyle',
				},
				{ label: __( 'Delete' ), role: 'delete' },
				{ label: __( 'Select All' ), role: 'selectAll' },
				{ type: 'separator' },
				{
					label: __( 'Speech' ),
					submenu: [
						{ label: __( 'Start Speaking' ), role: 'startSpeaking' },
						{ label: __( 'Stop Speaking' ), role: 'stopSpeaking' },
					],
				},
			],
		},
		{
			label: __( 'View' ),
			role: 'viewMenu',
			submenu: buildViewMenuItems( {
				isDevelopment: process.env.NODE_ENV === 'development',
				isAlwaysOnTop: mainWindow?.isAlwaysOnTop(),
				devTools,
				onToggleSidebar: () => {
					void sendIpcEventToRenderer( 'toggle-sidebar' );
				},
				onToggleSitePreview: () => {
					void sendIpcEventToRenderer( 'toggle-site-preview' );
				},
				onResetZoom: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'reset' ) );
				},
				onZoomIn: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'in' ) );
				},
				onZoomOut: () => {
					void withAppWebContents( ( contents ) => applyAppZoomCommand( contents, 'out' ) );
				},
			} ),
		},
		...( process.platform === 'win32'
			? []
			: [
					{
						label: __( 'Window' ),
						role: 'windowMenu',
						// We can't remove all of the items which aren't relevant to us (anything for
						// managing multiple window instances), but this seems to remove as many of
						// them as we can.
						submenu: [
							{ label: __( 'Minimize' ), role: 'minimize' },
							{ label: __( 'Zoom' ), role: 'zoom' },
						],
					} as MenuItemConstructorOptions,
			  ] ),
		{
			label: __( 'Help' ),
			role: 'help',
			submenu: [
				{
					label: __( 'WordPress Studio Help' ),
					click: async () => {
						const locale = await getUserLocaleWithFallback();
						void shellOpenExternalWrapper( getLocalizedLink( locale, 'docsStudio' ) );
					},
				},
				{
					label: __( "What's New" ),
					click: async () => {
						void sendIpcEventToRenderer( 'show-whats-new' );
					},
				},
				{
					label: __( 'Getting Started' ),
					click: async () => {
						void sendIpcEventToRenderer( 'show-getting-started' );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? [
							{
								label: __( 'How can I make WordPress Studio faster?' ),
								click: () => {
									void promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );
								},
							},
					  ]
					: [] ),
				{
					label: __( 'Open Application Logs' ),
					click: async () => {
						const logFilePath = getLogsFilePath();
						const err = await shell.openPath( logFilePath );
						if ( err ) {
							console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
						}
					},
				},
				{ type: 'separator' },
				{
					label: __( 'Report an Issue' ),
					click: () => {
						void shellOpenExternalWrapper( BUG_REPORT_URL );
					},
				},
				{
					label: __( 'Propose a Feature' ),
					click: () => {
						void shellOpenExternalWrapper( FEATURE_REQUEST_URL );
					},
				},
			],
		},
	] );
}
