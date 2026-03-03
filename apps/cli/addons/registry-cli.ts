/**
 * Addon Registry — CLI side.
 *
 * Imports only CLI addon entries (no React / Electron renderer code).
 * Mirrors the pattern of apps/studio/src/modules/addons/registry-main.ts.
 *
 * To add CLI commands for an addon:
 *   1. Create apps/studio/src/modules/addons/<addon-id>/index.cli.ts
 *      exporting a CliAddonRegistration with manifest + cliCommands.
 *   2. Import it here and add it to BUNDLED_CLI_REGISTRATIONS.
 *
 * Example (once an addon has CLI commands):
 *   import vipEnvironmentCli from 'src/modules/addons/vip-environment/index.cli';
 *   const BUNDLED_CLI_REGISTRATIONS: CliAddonRegistration[] = [ vipEnvironmentCli ];
 */
import type { AddonCliRegistration, AddonManifest } from '@studio/addon-api';

export interface CliAddonRegistration {
	manifest: AddonManifest;
	cliCommands: AddonCliRegistration[];
}

const BUNDLED_CLI_REGISTRATIONS: CliAddonRegistration[] = [
	// No addon CLI commands yet. Add entries here as addons gain CLI support.
];

export function getBundledCliRegistrations(): CliAddonRegistration[] {
	return BUNDLED_CLI_REGISTRATIONS;
}
