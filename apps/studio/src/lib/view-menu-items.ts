import { __ } from '@wordpress/i18n';
import type { MenuItemConstructorOptions } from 'electron';

interface ViewMenuItemsOptions {
	needsOnboarding: boolean;
	isAgenticUiEnabled: boolean;
	isDevelopment: boolean;
	isAlwaysOnTop?: boolean;
	devTools: MenuItemConstructorOptions[];
	onToggleSitePreview: () => void;
}

export function getViewMenuItems( {
	needsOnboarding,
	isAgenticUiEnabled,
	isDevelopment,
	isAlwaysOnTop,
	devTools,
	onToggleSitePreview,
}: ViewMenuItemsOptions ): MenuItemConstructorOptions[] {
	return [
		{ label: __( 'Show Tab Bar' ), role: 'toggleTabBar' },
		{ label: __( 'Show All Tabs' ), role: 'showAllTabs' },
		...( isAgenticUiEnabled
			? [
					{
						label: __( 'Toggle Site Preview' ),
						accelerator: 'CommandOrControl+Shift+B',
						enabled: ! needsOnboarding,
						click: onToggleSitePreview,
					} as MenuItemConstructorOptions,
			  ]
			: [] ),
		...( isDevelopment ? devTools : [] ),
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
			checked: isAlwaysOnTop,
			click: ( _menuItem, browserWindow ) => {
				if ( browserWindow ) {
					browserWindow.setAlwaysOnTop( ! browserWindow.isAlwaysOnTop(), 'floating' );
				}
			},
		},
	];
}
