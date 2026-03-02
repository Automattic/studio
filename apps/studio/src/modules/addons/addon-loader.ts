/**
 * Addon Loader — Registers addons in the Main process at boot time.
 *
 * Iterates getBundledAddonMainRegistrations(), registers IPC handlers
 * directly on ipcMain, then calls onInitialize hooks.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { createAddonStorage } from 'src/modules/addons/addon-storage';
import { getBundledAddonMainRegistrations } from 'src/modules/addons/registry-main';
import type {
	AddonDefinition,
	AddonContentTab,
	AddonContextMenuItem,
	AddonHeaderAction,
	AddonSettingsPanel,
	AddonTopBarItem,
} from 'src/modules/addons/addon-api';

type MainAddonRegistration = Pick<
	AddonDefinition,
	'manifest' | 'ipcHandlers' | 'onInitialize' | 'onTeardown'
>;

let loadedAddons: MainAddonRegistration[] = [];

export async function initializeAddons(
	validateIpcSender: ( event: IpcMainInvokeEvent ) => boolean
): Promise< void > {
	const addons = getBundledAddonMainRegistrations();
	loadedAddons = [];

	for ( const addon of addons ) {
		try {
			// Register IPC handlers
			for ( const registration of addon.ipcHandlers ?? [] ) {
				const wrappedHandler = async (
					event: IpcMainInvokeEvent,
					...args: unknown[]
				): Promise< unknown > => {
					try {
						validateIpcSender( event );
						return await registration.handler( event, ...args );
					} catch ( error ) {
						console.error(
							`[Addons] IPC handler "${ registration.channelName }" for addon "${ addon.manifest.id }" threw:`,
							error
						);
						throw error;
					}
				};

				if ( registration.isVoid ) {
					ipcMain.on( registration.channelName, ( event, ...args ) => {
						void wrappedHandler( event as IpcMainInvokeEvent, ...args );
					} );
				} else {
					ipcMain.handle( registration.channelName, wrappedHandler );
				}
			}

			// Call lifecycle hook
			if ( addon.onInitialize ) {
				const storage = createAddonStorage( addon.manifest.id );
				await addon.onInitialize( { storage } );
			}

			loadedAddons.push( addon );
			console.log( `[Addons] Loaded addon: ${ addon.manifest.id } v${ addon.manifest.version }` );
		} catch ( error ) {
			console.error( `[Addons] Failed to initialize addon "${ addon.manifest.id }":`, error );
		}
	}
}

export async function teardownAddons(): Promise< void > {
	for ( const addon of [ ...loadedAddons ].reverse() ) {
		try {
			if ( addon.onTeardown ) {
				await addon.onTeardown();
			}
		} catch ( error ) {
			console.error( `[Addons] Error during teardown of addon "${ addon.manifest.id }":`, error );
		}
	}
	loadedAddons = [];
}

// ─── Renderer slot accessors (called from Main-process code that builds menus) ─

export function getAddonContextMenuItems(): AddonContextMenuItem[] {
	return ( loadedAddons as AddonDefinition[] ).flatMap( ( addon ) => addon.contextMenuItems ?? [] );
}

// The following are used by renderer-side companion files via a static import,
// not called from Main process code. They are exported here for completeness and
// future server-side rendering use cases.

export function getAddonContentTabs(): AddonContentTab[] {
	return ( loadedAddons as AddonDefinition[] ).flatMap( ( addon ) => addon.contentTabs ?? [] );
}

export function getAddonHeaderActions(): AddonHeaderAction[] {
	return ( loadedAddons as AddonDefinition[] ).flatMap( ( addon ) => addon.headerActions ?? [] );
}

export function getAddonSettingsPanels(): AddonSettingsPanel[] {
	return ( loadedAddons as AddonDefinition[] ).flatMap( ( addon ) => addon.settingsPanels ?? [] );
}

export function getAddonTopBarItems(): AddonTopBarItem[] {
	return ( loadedAddons as AddonDefinition[] ).flatMap( ( addon ) => addon.topBarItems ?? [] );
}

export function getLoadedAddons(): MainAddonRegistration[] {
	return loadedAddons;
}
