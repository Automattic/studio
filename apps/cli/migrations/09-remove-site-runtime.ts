/**
 * The Sandbox (Playground) runtime is being retired: every site now runs on native PHP, so the
 * per-site `runtime` setting is dropped. Former Sandbox sites get the PHP version native actually
 * runs, so their settings don't show a version that isn't used.
 */

import { getClosestSupportedPhpVersion } from '@studio/common/types/php-versions';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import type { Migration } from '@studio/common/lib/migration';

// The value older Studio versions stored for sites on the Sandbox runtime.
const SANDBOX_RUNTIME = 'playground';

export const removeSiteRuntime: Migration = {
	async needsToRun() {
		const { sites } = await readCliConfig();
		return sites.some( ( site ) => site.runtime !== undefined );
	},

	async run() {
		try {
			await lockCliConfig();
			const config = await readCliConfig();
			for ( const site of config.sites ) {
				if ( site.runtime === undefined ) {
					continue;
				}
				if ( site.runtime === SANDBOX_RUNTIME && site.phpVersion ) {
					site.phpVersion = getClosestSupportedPhpVersion( site.phpVersion ) ?? site.phpVersion;
				}
				delete site.runtime;
			}
			await saveCliConfig( config );
		} finally {
			await unlockCliConfig();
		}
	},
};
