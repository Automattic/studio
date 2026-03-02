/**
 * Addon Registry — Main-process side.
 *
 * Imports only Main-process addon entries (no React / renderer code).
 * Used by addon-loader.ts to register IPC handlers and lifecycle hooks.
 */
import vipEnvironmentMain from './vip-environment/index.main';
import type { AddonDefinition } from 'src/modules/addons/addon-api';

type MainAddonRegistration = Pick<
	AddonDefinition,
	'manifest' | 'ipcHandlers' | 'onInitialize' | 'onTeardown'
>;

const BUNDLED_ADDON_MAIN_REGISTRATIONS: MainAddonRegistration[] = [ vipEnvironmentMain ];

export function getBundledAddonMainRegistrations(): MainAddonRegistration[] {
	return BUNDLED_ADDON_MAIN_REGISTRATIONS;
}
