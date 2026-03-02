/**
 * Addon Preload API Merger — Preload script side.
 *
 * Collects preloadApi records from all bundled addons and merges them
 * into a single object to be spread into the `api` object before
 * contextBridge.exposeInMainWorld.
 */
import { getBundledAddons } from 'src/modules/addons/registry';

/**
 * Returns a merged record of all addon preload API methods.
 * Safe to spread into the core `api` object in preload.ts.
 */
export function mergeAddonPreloadApis(): Record< string, ( ...args: unknown[] ) => unknown > {
	const merged: Record< string, ( ...args: unknown[] ) => unknown > = {};
	for ( const addon of getBundledAddons() ) {
		if ( addon.preloadApi ) {
			Object.assign( merged, addon.preloadApi );
		}
	}
	return merged;
}
