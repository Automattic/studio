/**
 * Addon Registry — Discovery layer.
 *
 * v1: Static array of bundled addons.
 * v2: Replace getBundledAddons() with a dynamic directory scan + require().
 *     The AddonDefinition contract and all downstream code remain unchanged.
 */
import vipEnvironmentAddon from './vip-environment/index.renderer';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

const BUNDLED_ADDONS: AddonDefinition[] = [ vipEnvironmentAddon ];

export function getBundledAddons(): AddonDefinition[] {
	return BUNDLED_ADDONS;
}

/** Module-level cache of enabled addon IDs, populated by initEnabledAddons() at renderer boot. */
let _enabledAddonIds: Set< string > | null = null;

/**
 * Call once at renderer startup (before root.render) with the persisted enabled IDs.
 * Until called, getEnabledAddons() returns all addons (safe default for tests/storybook).
 */
export function initEnabledAddons( ids: string[] ): void {
	_enabledAddonIds = new Set( ids );
}

/**
 * Returns only the addons that the user has enabled.
 * Use this everywhere UI is rendered. Use getBundledAddons() only in the Add-ons settings tab.
 */
export function getEnabledAddons(): AddonDefinition[] {
	if ( _enabledAddonIds === null ) {
		return BUNDLED_ADDONS;
	}
	return BUNDLED_ADDONS.filter( ( addon ) => _enabledAddonIds!.has( addon.manifest.id ) );
}

/**
 * Validates that the addon declares all permissions it uses.
 * In v1 this is informational; in v2 it becomes a hard gate.
 */
export function validateAddonAgainstManifest( addon: AddonDefinition ): void {
	const { manifest } = addon;
	const { permissions } = manifest;

	const checks: Array< { field: keyof AddonDefinition; permission: string } > = [
		{ field: 'ipcHandlers', permission: 'ipc:' },
		{ field: 'preloadApi', permission: 'ipc:' },
		{ field: 'contentTabs', permission: 'ui:content-tabs' },
		{ field: 'contextMenuItems', permission: 'ui:context-menu' },
		{ field: 'headerActions', permission: 'ui:header-actions' },
		{ field: 'sidebarContent', permission: 'ui:sidebar-content' },
		{ field: 'settingsPanels', permission: 'ui:settings-panel' },
		{ field: 'topBarItems', permission: 'ui:top-bar' },
		{ field: 'mainContentRenderer', permission: 'ui:main-content' },
		{ field: 'addSiteFlows', permission: 'ui:add-site-flow' },
		{ field: 'appProviders', permission: 'ui:app-providers' },
		{ field: 'cliCommands', permission: 'cli:commands' },
	];

	for ( const { field, permission } of checks ) {
		const value = addon[ field ];
		const hasValue = Array.isArray( value ) ? value.length > 0 : value != null;

		if ( ! hasValue ) continue;

		const hasPermission = permissions.some( ( p: string ) =>
			permission.endsWith( ':' ) ? p.startsWith( permission ) : p === permission
		);

		if ( ! hasPermission ) {
			console.warn(
				`[Addons] Addon "${ manifest.id }" uses "${ String(
					field
				) }" but does not declare permission "${ permission }".`
			);
		}
	}
}
