/**
 * Addon Store Enhancer — Renderer side.
 *
 * Collects AddonReduxRegistration[] from all bundled addons and exports
 * helpers to merge them into the root Redux store.
 */
import { getBundledAddons } from 'src/modules/addons/registry';
import type { AddonReduxRegistration } from 'src/modules/addons/addon-api';

function getAddonReduxRegistrations(): AddonReduxRegistration[] {
	return getBundledAddons().flatMap( ( addon ) => addon.redux ?? [] );
}

/**
 * Returns a map of `{ [key]: reducer }` suitable for spreading into `combineReducers()`.
 */
export function buildAddonReducers(): Record<
	string,
	( state: unknown, action: unknown ) => unknown
> {
	const result: Record< string, ( state: unknown, action: unknown ) => unknown > = {};
	for ( const registration of getAddonReduxRegistrations() ) {
		result[ registration.key ] = registration.reducer;
	}
	return result;
}

/**
 * Returns all addon middlewares to concat onto the default middleware stack.
 */
export function getAddonMiddlewares(): unknown[] {
	return getAddonReduxRegistrations().flatMap( ( reg ) => reg.middleware ?? [] );
}
