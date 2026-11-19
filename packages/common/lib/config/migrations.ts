import { CONFIG_VERSION } from '@studio/common/lib/config/schema';
import type { RawConfig } from '@studio/common/lib/config/store';

/**
 * The steps that bring a config file from an older build up to `CONFIG_VERSION`: the step at index
 * `n` turns version `n + 1` into version `n + 2`. Each is a pure function of the raw file, so it
 * runs the same in every Studio app and is tested input against output.
 */
const STEPS: ( ( raw: RawConfig ) => RawConfig )[] = [];

export function migrateConfig( raw: RawConfig ): RawConfig {
	let migrated = raw;
	for ( let version = Number( raw.version ) || 1; version < CONFIG_VERSION; version++ ) {
		migrated = STEPS[ version - 1 ]( migrated );
	}
	return { ...migrated, version: CONFIG_VERSION };
}
