import { Menu, type MenuItemConstructorOptions, app, BrowserWindow, autoUpdater } from 'electron';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from './about-menu/open-about-menu';
import { BUG_REPORT_URL, FEATURE_REQUEST_URL, STUDIO_DOCS_URL } from './constants';
import { shellOpenExternalWrapper } from './lib/shell-open-external-wrapper';
import { promptWindowsSpeedUpSites } from './lib/windows-helpers';
import { getMainWindow } from './main-window';
import { isUpdateReadyToInstall, manualCheckForUpdates } from './updates';

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
				const window = await getMainWindow();
				window.webContents.send( 'test-render-failure' );
			},
		},
	];

	const devTools: MenuItemConstructorOptions[] = [
		{ role: 'reload' },
		{ role: 'forceReload' },
		{ role: 'toggleDevTools' },
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
						const window = await getMainWindow();
						window.webContents.send( 'user-settings' );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { role: 'services' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.platform === 'win32'
					? []
					: [ { role: 'hide' } as MenuItemConstructorOptions ] ),
				{ type: 'separator' },
				...( process.env.NODE_ENV === 'development' ? crashTestMenuItems : [] ),
				{ type: 'separator' },
				{ role: 'quit' },
			],
		},
		{
			role: 'fileMenu',
			submenu: [
				{
					label: __( 'Add Site…' ),
					accelerator: 'CommandOrControl+N',
					click: async () => {
						const window = await getMainWindow();
						window.webContents.send( 'add-site' );
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
		...( process.platform === 'win32'
			? []
			: [
					{
						role: 'editMenu',
					} as MenuItemConstructorOptions,
			  ] ),
		{
			role: 'viewMenu',
			submenu: [
				...( process.env.NODE_ENV === 'development' ? devTools : [] ),
				{ role: 'resetZoom' },
				{ role: 'zoomIn' },
				{ role: 'zoomOut' },
				{ type: 'separator' },
				{ role: 'togglefullscreen' },
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
						role: 'windowMenu',
						// We can't remove all of the items which aren't relevant to us (anything for
						// managing multiple window instances), but this seems to remove as many of
						// them as we can.
						submenu: [ { role: 'minimize' }, { role: 'zoom' } ],
					} as MenuItemConstructorOptions,
			  ] ),
		{
			role: 'help',
			submenu: [
				{
					label: __( 'Studio Help' ),
					click: () => {
						shellOpenExternalWrapper( STUDIO_DOCS_URL );
					},
				},
				{ type: 'separator' },
				...( process.platform === 'win32'
					? [
							{
								label: __( 'How can I make Studio faster?' ),
								click: () => {
									promptWindowsSpeedUpSites( { skipIfAlreadyPrompted: false } );
								},
							},
					  ]
					: [] ),
				{ type: 'separator' },
				{
					label: __( 'Report an Issue' ),
					click: () => {
						shellOpenExternalWrapper( BUG_REPORT_URL );
					},
				},
				{
					label: __( 'Propose a Feature' ),
					click: () => {
						shellOpenExternalWrapper( FEATURE_REQUEST_URL );
					},
				},
			],
		},
	] );
}
