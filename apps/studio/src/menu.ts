import {
	Menu,
	type MenuItemConstructorOptions,
	app,
	BrowserWindow,
	autoUpdater,
	MenuItem,
	shell,
	type WebContents,
} from 'electron';
import {
	getAppConfigPath,
	getCliConfigPath,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { openAboutWindow } from 'src/about-menu/open-about-menu';
import { BUG_REPORT_URL, FEATURE_REQUEST_URL } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import {
	BetaFeatureDefinition,
	getBetaFeatures,
	getBetaFeaturesDefinition,
	updateBetaFeature,
} from 'src/lib/beta-features';
import { bumpStat, getPlatformMetric, StatsGroup } from 'src/lib/bump-stats';
import {
	FEATURE_FLAGS,
	FeatureFlagDefinition,
	getFeatureFlagFromEnv,
	setFeatureFlagInEnv,
} from 'src/lib/feature-flags';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getPreferredStudioUiMode, setAgenticUiEnabled } from 'src/lib/studio-ui-mode';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { getLogsFilePath } from 'src/logging';
import { getMainWindow, loadMainWindowRenderer } from 'src/main-window';
import { getAgenticFeaturesEnabled } from 'src/modules/user-settings/lib/ipc-handlers';
import { isUpdateReadyToInstall, manualCheckForUpdates } from 'src/updates';

// Runs against the app window's own contents rather than whatever has focus.
async function withAppWebContents( run: ( contents: WebContents ) => void ) {
	const window = await getMainWindow();
	if ( window && ! window.isDestroyed() && ! window.webContents.isDestroyed() ) {
		run( window.webContents );
	}
}

export async function setupMenu( config: {
	needsOnboarding: boolean;
	isAddSiteVisible?: boolean;
} ) {
	const mainWindow = await getMainWindow();
	if ( ! mainWindow && process.platform !== 'darwin' ) {
		Menu.setApplicationMenu( null );
		return;
	}
	const menu = await getAppMenu( mainWindow, config );
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

async function buildBetaFeaturesMenu(): Promise< MenuItemConstructorOptions[] > {
	const currentBetaFeatures = await getBetaFeatures();
	return Object.entries< BetaFeatureDefinition >( getBetaFeaturesDefinition() ).map(
		( [ key, definition ] ) => {
			// On Windows, use the description as the label for a more compact display
			const label =
				process.platform === 'win32' && definition.description
					? definition.description
					: definition.label;

			return {
				label,
				type: 'checkbox' as const,
				checked: currentBetaFeatures[ key as keyof BetaFeatures ],
				// Only use sublabel on macOS where it displays nicely
				sublabel: process.platform === 'darwin' ? definition.description : undefined,
				click: async ( menuItem: MenuItem ) => {
					await updateBetaFeature(
						key as keyof BetaFeatures,
						menuItem.checked,
						key === 'enableAgenticUi' ? 'menu' : undefined
					);
					if ( key === 'remoteSession' ) {
						bumpStat(
							menuItem.checked
								? StatsGroup.STUDIO_APP_DOLLY_ENABLE
								: StatsGroup.STUDIO_APP_DOLLY_DISABLE,
							getPlatformMetric()
						);
					}
					if ( key === 'enableAgenticUi' ) {
						setAgenticUiEnabled( menuItem.checked );
						const mainWindow = await getMainWindow();
						if ( mainWindow && ! mainWindow.isDestroyed() ) {
							// The renderer is being replaced; it fetches fresh state on boot,
							// and messaging the dying page fails IPC sender validation.
							setTimeout( () => {
								void loadMainWindowRenderer( mainWindow );
							}, 0 );
							return;
						}
					}
					void sendIpcEventToRenderer( 'beta-features-updated' );
				},
			};
		}
	);
}

export function buildViewMenuItems( {
	needsOnboarding,
	isDevelopment,
	isAlwaysOnTop,
	devTools,
	onToggleSidebar,
	onToggleSitePreview,
}: {
	needsOnboarding: boolean;
	isDevelopment: boolean;
	isAlwaysOnTop?: boolean;
	devTools: MenuItemConstructorOptions[];
	onToggleSidebar: () => void;
	onToggleSitePreview: () => void;
} ): MenuItemConstructorOptions[] {
	return [
		{
			label: __( 'Toggle Sidebar' ),
			accelerator: 'CommandOrControl+B',
			enabled: ! needsOnboarding,
			click: onToggleSidebar,
		},
		...( getPreferredStudioUiMode() === 'agentic'
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

async function getAppMenu(
	mainWindow: BrowserWindow | null,
	{
		needsOnboarding = false,
		isAddSiteVisible = false,
	}: { needsOnboarding?: boolean; isAddSiteVisible?: boolean } = {}
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

	// Cmd/Ctrl+R belongs to the site preview: the agentic renderer binds it in
	// the DOM to reload the guest page, so the menu must leave the key alone
	// there — a menu accelerator would consume it first. That leaves the app
	// itself with no way to reload, so these target the app window explicitly
	// rather than using `role: 'reload'`, which acts on whatever webContents
	// has focus (the preview, once clicked into).
	const previewOwnsReloadShortcut = getPreferredStudioUiMode() === 'agentic';
	const devTools: MenuItemConstructorOptions[] = [
		{
			label: __( 'Reload App' ),
			...( previewOwnsReloadShortcut ? {} : { accelerator: 'CommandOrControl+R' } ),
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

	const featureFlagsMenu: MenuItemConstructorOptions[] = Object.entries< FeatureFlagDefinition >(
		FEATURE_FLAGS
	).map( ( [ flag, definition ] ) => ( {
		label: definition.label,
		type: 'checkbox' as const,
		checked: getFeatureFlagFromEnv( flag as keyof FeatureFlags ),
		click: ( menuItem: MenuItem ) => {
			setFeatureFlagInEnv( flag as keyof FeatureFlags, menuItem.checked );
			void sendIpcEventToRenderer( 'refresh-app-globals' );
		},
	} ) );

	const betaFeaturesMenu = await buildBetaFeaturesMenu();

	// The agentic UI binds Cmd/Ctrl+N to "New chat" in the renderer, so the menu must leave the
	// key alone there — a menu accelerator would consume it before it reaches the DOM. With chat
	// switched off nothing binds it, so the shortcut falls back to "Add Site…" as in classic.
	const rendererOwnsNewShortcut =
		getPreferredStudioUiMode() === 'agentic' && ( await getAgenticFeaturesEnabled() );

	return Menu.buildFromTemplate( [
		{
			label: app.name, // macOS ignores this name and uses the name from the .plist
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
				{
					label: __( 'Beta Features' ),
					submenu: betaFeaturesMenu,
					enabled: betaFeaturesMenu.length > 0,
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
							{
								label: __( 'Feature Flags' ),
								submenu: featureFlagsMenu,
								enabled: featureFlagsMenu.length > 0,
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
					accelerator: rendererOwnsNewShortcut ? undefined : 'CommandOrControl+N',
					click: async () => {
						void sendIpcEventToRenderer( 'add-site' );
					},
					enabled: ! needsOnboarding && ! isAddSiteVisible,
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
				needsOnboarding,
				isDevelopment: process.env.NODE_ENV === 'development',
				isAlwaysOnTop: mainWindow?.isAlwaysOnTop(),
				devTools,
				onToggleSidebar: () => {
					void sendIpcEventToRenderer( 'toggle-sidebar' );
				},
				onToggleSitePreview: () => {
					void sendIpcEventToRenderer( 'toggle-site-preview' );
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
					enabled: ! needsOnboarding,
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
