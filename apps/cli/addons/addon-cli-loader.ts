/**
 * CLI Addon Loader — Registers addon CLI commands with yargs.
 *
 * v1: Static array (mirrors registry.ts bundled addons pattern).
 * v2: Dynamically loaded from the same addon packages.
 */

// Add imports here as addons are vendored in, e.g.:
// import vipEnvironmentAddon from '@studio-addons/vip-environment';
import type { AddonDefinition } from '@studio/addon-api';

const BUNDLED_CLI_ADDONS: AddonDefinition[] = [
	// vipEnvironmentAddon,
];

/**
 * Registers all addon CLI commands with the provided yargs instance.
 * Call this after all core commands are registered in apps/cli/index.ts.
 */
export function registerAddonCliCommands( studioArgv: unknown ): void {
	for ( const addon of BUNDLED_CLI_ADDONS ) {
		for ( const registration of addon.cliCommands ?? [] ) {
			try {
				registration.register( studioArgv );
			} catch ( error ) {
				console.error(
					`[Addons] Failed to register CLI commands for addon "${ addon.manifest.id }":`,
					error
				);
			}
		}
	}
}
