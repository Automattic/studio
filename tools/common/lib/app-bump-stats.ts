import {
	lockAppConfig,
	readAppConfig,
	saveAppConfig,
	unlockAppConfig,
} from '@studio/common/lib/app-config';
import type { LastBumpStats, LastBumpStatsProvider } from '@studio/common/lib/bump-stat';

/**
 * `LastBumpStatsProvider` backed by `~/.studio/app.json` via the shared
 * app-config accessor. Only the `lastBumpStats` field is read/written; all other
 * app.json state is preserved, and writes go through the app.json lockfile.
 */
export const appBumpStatsProvider: LastBumpStatsProvider = {
	load: async () => {
		const config = await readAppConfig();
		return ( config.lastBumpStats as LastBumpStats | undefined ) ?? {};
	},
	lock: lockAppConfig,
	unlock: unlockAppConfig,
	save: async ( lastBumpStats ) => {
		const config = await readAppConfig();
		config.lastBumpStats = lastBumpStats;
		await saveAppConfig( config );
	},
};
