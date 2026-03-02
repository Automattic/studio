/**
 * Addon Preload API Merger — Preload script side.
 *
 * Imports preloadApi objects from each addon's preload entry directly.
 * These entries use ipcRenderer and must ONLY be imported from the preload bundle.
 * Do NOT import this file from the renderer bundle.
 */
import { vipPreloadApi } from './vip-environment/index.preload';

/**
 * Returns a merged record of all addon preload API methods.
 * Safe to spread into the core `api` object in preload.ts.
 */
export function mergeAddonPreloadApis(): Record< string, ( ...args: unknown[] ) => unknown > {
	return {
		...vipPreloadApi,
	};
}
