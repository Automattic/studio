/**
 * Access to WordPress private APIs.
 *
 * Some @wordpress packages (like @wordpress/theme) expose components behind
 * the private APIs mechanism. Only allowlisted @wordpress/* module names can
 * opt in. We register as an unused core module name to obtain the unlock
 * function, which shares a global WeakMap with all other registered modules.
 */
import { __dangerousOptInToUnstableAPIsOnlyForCoreModules } from '@wordpress/private-apis';

export const { lock, unlock } = __dangerousOptInToUnstableAPIsOnlyForCoreModules(
	'I acknowledge private features are not for use in themes or plugins and doing so will break in the next version of WordPress.',
	'@wordpress/boot'
);
