/**
 * CLI Addon Loader — Registers addon CLI commands with yargs.
 *
 * Iterates getBundledCliRegistrations() and calls each addon's
 * cliCommands[].register() with the yargs instance.
 *
 * Mirrors the pattern of apps/studio/src/modules/addons/addon-loader.ts.
 */
import { getBundledCliRegistrations } from 'cli/addons/registry-cli';

/**
 * Registers all addon CLI commands with the provided yargs instance.
 * Call this after all core commands are registered in apps/cli/index.ts.
 */
export function registerAddonCliCommands( studioArgv: unknown ): void {
	for ( const addon of getBundledCliRegistrations() ) {
		for ( const registration of addon.cliCommands ) {
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
