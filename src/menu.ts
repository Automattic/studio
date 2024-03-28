import { Menu, type MenuItemConstructorOptions, app, BrowserWindow } from 'electron';
import { __ } from '@wordpress/i18n';
import { createMainWindow } from './main-window';
import { manualCheckForUpdates } from './updates';

export function setupMenu( window: BrowserWindow | null ) {
	if ( ! window && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}

	const withWindow = withMainWindow( window );
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
				{ label: __( 'Check for Updates' ), click: manualCheckForUpdates },
				{ type: 'separator' },
				{
					label: __( 'Settings…' ),
					accelerator: 'CommandOrControl+,',
					click: () => {
						withWindow( ( browserWindow: BrowserWindow ) => {
							browserWindow.webContents.send( 'user-settings' );
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
						withWindow( ( browserWindow: BrowserWindow ) => {
							browserWindow.webContents.send( 'add-site' );
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
					enabled: !! window,
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
			submenu: [ { label: __( 'Support' ), enabled: false } ],
		},
	] );

	if ( process.platform === 'darwin' ) {
		Menu.setApplicationMenu( menu );
		return;
	}
	// Make menu accessible in development for non-macOS platforms
	if ( process.env.NODE_ENV === 'development' ) {
		window?.setMenu( menu );
		return;
	}
	Menu.setApplicationMenu( null );
}

function withMainWindow(
	window: BrowserWindow | null
): ( callback: ( window: BrowserWindow ) => void ) => void {
	return function ( callback: ( window: BrowserWindow ) => void ) {
		if ( window ) {
			callback( window );
			return;
		}
		const newWindow = createMainWindow();
		newWindow.webContents.on( 'did-finish-load', () => {
			callback( newWindow );
		} );
	};
}
