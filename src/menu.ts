import {
	Menu,
	type MenuItemConstructorOptions,
	app,
	BrowserWindow,
	autoUpdater,
	shell,
} from 'electron';
import { __ } from '@wordpress/i18n';
import { STUDIO_DOCS_URL } from './constants';
import { withMainWindow } from './main-window';
import { isUpdateReadyToInstall, manualCheckForUpdates } from './updates';

export function setupMenu( mainWindow: BrowserWindow | null ) {
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}

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

	const menu = Menu.buildFromTemplate( [
		{
			label: app.name, // macOS ignores this name and uses the name from the .plist
			role: 'appMenu',
			submenu: [
				{ role: 'about' },
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
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
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
				{
					label: __( 'Close Window' ),
					accelerator: 'CommandOrControl+W',
					click: ( menuItem, browserWindow ) => {
						browserWindow?.close();
						setupMenu( null );
					},
					enabled: !! mainWindow && ! mainWindow.isDestroyed(),
				},
			],
		},
		{
			role: 'editMenu',
		},
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
		{
			role: 'windowMenu',
			// We can't remove all of the items which aren't relevant to us (anything for
			// managing multiple window instances), but this seems to remove as many of
			// them as we can.
			submenu: [ { role: 'minimize' }, { role: 'zoom' } ],
		},
		{
			role: 'help',
			submenu: [
				{
					label: __( 'Studio Help' ),
					click: () => {
						shell.openExternal( STUDIO_DOCS_URL );
					},
				},
			],
		},
	] );

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
