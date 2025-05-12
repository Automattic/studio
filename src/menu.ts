import { Menu, type MenuItemConstructorOptions, app, BrowserWindow, autoUpdater } from 'electron';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from 'src/about-menu/open-about-menu';
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { translateLink } from 'src/lib/translate-link';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { getMainWindow } from 'src/main-window';
import { installCLIOnMacOSWithConfirmation } from 'src/modules/cli/lib/install-macos';
import { isUpdateReadyToInstall, manualCheckForUpdates } from 'src/updates';

export async function setupMenu( config: { needsOnboarding: boolean } ) {
	const mainWindow = await getMainWindow();
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}
	const menu = getAppMenu( mainWindow, config );
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

export async function popupMenu() {
	const window = await getMainWindow();
	const menu = getAppMenu( window );
	menu.popup();
}

function getAppMenu(
	mainWindow: BrowserWindow | null,
	{ needsOnboarding = false }: { needsOnboarding?: boolean } = {}
) {
	const crashTestMenuItems: MenuItemConstructorOptions[] = [
		{
			label: __( 'Test Hard Crash (dev only)' ),
			click: () => {
				process.crash();
			},
		},
		{
			label: __( 'Test Render Failure (dev only)' ),
			click: async () => {
				void sendIpcEventToRenderer( 'test-render-failure' );
			},
		},
	];

	const devTools: MenuItemConstructorOptions[] = [
		{ label: __( 'Reload' ), role: 'reload' },
		{ label: __( 'Force Reload' ), role: 'forceReload' },
		{ label: __( 'Toggle DevTools' ), role: 'toggleDevTools' },
		{ type: 'separator' },
	];

	return Menu.buildFromTemplate( [
		{
			label: app.name, // macOS ignores this name and uses the name from the .plist
			role: 'appMenu',
			submenu: [
				{
					label: __( 'About Studio' ),
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
						void sendIpcEventToRenderer( 'user-settings' );
					},
				},
				...( process.platform === 'darwin'
					? [
							{
								label: __( 'Install CLI…' ),
								click: installCLIOnMacOSWithConfirmation,
							},
					  ]
					: [] ),
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
					enabled: ! needsOnboarding,
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
			submenu: [
				{ label: __( 'Show Tab Bar' ), role: 'toggleTabBar' },
				{ label: __( 'Show All Tabs' ), role: 'showAllTabs' },
				...( process.env.NODE_ENV === 'development' ? devTools : [] ),
				{
					label: __( 'Actual Size' ),
					role: 'resetZoom',
				},
				{
					label: __( 'Zoom In' ),
					role: 'zoomIn',
				},
				{
					label: __( 'Zoom Out' ),
					role: 'zoomOut',
				},
				{ type: 'separator' },
				{
					label: __( 'Toggle Fullscreen' ),
					role: 'togglefullscreen',
				},
				{ type: 'separator' },
				{
					label: __( 'Float on Top of All Other Windows' ),
					type: 'checkbox',
					checked: mainWindow?.isAlwaysOnTop(),
					click: ( _menuItem, browserWindow ) => {
						if ( browserWindow ) {
							browserWindow.setAlwaysOnTop( ! browserWindow.isAlwaysOnTop(), 'floating' );
						}
					},
				},
			],
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
							{ type: 'separator' },
							{ label: __( 'Show Previous Tab' ), role: 'selectPreviousTab' },
							{ label: __( 'Show Next Tab' ), role: 'selectNextTab' },
							{ label: __( 'Move Tab to New Window' ), role: 'moveTabToNewWindow' },
							{ label: __( 'Merge All Windows' ), role: 'mergeAllWindows' },
						],
					} as MenuItemConstructorOptions,
			  ] ),
		{
			label: __( 'Help' ),
			role: 'help',
			submenu: [
				{
					label: __( 'Studio Help' ),
					click: async () => {
						const locale = await getUserLocaleWithFallback();
						void shellOpenExternalWrapper( translateLink( locale, 'studio' ) );
					},
				},
				{
					label: __( "What's New" ),
					click: async () => {
						void sendIpcEventToRenderer( 'show-whats-new' );
					},
					enabled: ! needsOnboarding,
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? [
							{
								label: __( 'How can I make Studio faster?' ),
								click: () => {
									void promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );
								},
							},
					  ]
					: [] ),
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
