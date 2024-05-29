import {
	Menu,
	type MenuItemConstructorOptions,
	app,
	BrowserWindow,
	autoUpdater,
	shell,
} from 'electron';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from './about-menu/open-about-menu';
import { BUG_REPORT_URL, FEATURE_REQUEST_URL, STUDIO_DOCS_URL} from './constants';
import { withMainWindow } from './main-window';
import { isUpdateReadyToInstall, manualCheckForUpdates } from './updates';

export function setupMenu( mainWindow: BrowserWindow | null ) {
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}
	const menu = getAppMenu( mainWindow );
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

export function popupMenu() {
	withMainWindow( ( window ) => {
		const menu = getAppMenu( window );
		menu.popup();
	} );
}

function getAppMenu( mainWindow: BrowserWindow | null ) {
	const crashTestMenuItems: MenuItemConstructorOptions[] = [
		{
			label: __( 'Test Hard Crash (dev only)' ),
			click: () => {
				process.crash();
			},
		},
		{
			label: __( 'Test Render Failure (dev only)' ),
			click: ( menuItem, browserWindow ) => {
				browserWindow?.webContents.send( 'test-render-failure' );
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
					click: () => {
						withMainWindow( ( window ) => {
							window.webContents.send( 'user-settings' );
						} );
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
					click: () => {
						withMainWindow( ( window ) => {
							window.webContents.send( 'add-site' );
						} );
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
						shell.openExternal( STUDIO_DOCS_URL );
					},
				},
				{ type: 'separator' },
				{
					label: __( 'Report an Issue' ),
					click: () => {
						shell.openExternal( BUG_REPORT_URL );
					},
				},
				{
					label: __( 'Propose a Feature' ),
					click: () => {
						shell.openExternal( FEATURE_REQUEST_URL );
					},
				},
			],
		},
	] );
}
