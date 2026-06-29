import fs from 'node:fs';
import path from 'node:path';
import { readFile, writeFile } from 'atomically';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '@studio/common/constants';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getAppConfigLockFilePath, getAppConfigPath } from '@studio/common/lib/well-known-paths';
import type { LastBumpStats, LastBumpStatsProvider } from '@studio/common/lib/bump-stat';

/**
 * `LastBumpStatsProvider` backed by `~/.studio/app.json`. Only the `lastBumpStats`
 * field is read/written — all other app.json state is preserved — and writes go
 * through the app.json lockfile, so concurrent writers are serialized.
 */

async function readAppConfig(): Promise< Record< string, unknown > > {
	try {
		return JSON.parse( await readFile( getAppConfigPath(), 'utf-8' ) ) as Record< string, unknown >;
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return {};
		}
		throw error;
	}
}

export const appBumpStatsProvider: LastBumpStatsProvider = {
	load: async () => {
		const config = await readAppConfig();
		return ( config.lastBumpStats as LastBumpStats | undefined ) ?? {};
	},
	lock: async () => {
		const lockPath = getAppConfigLockFilePath();
		const dir = path.dirname( lockPath );
		if ( ! fs.existsSync( dir ) ) {
			fs.mkdirSync( dir, { recursive: true } );
		}
		await lockFileAsync( lockPath, { stale: LOCKFILE_STALE_TIME, wait: LOCKFILE_WAIT_TIME } );
	},
	unlock: async () => {
		await unlockFileAsync( getAppConfigLockFilePath() );
	},
	save: async ( lastBumpStats ) => {
		const config = await readAppConfig();
		config.lastBumpStats = lastBumpStats;
		await writeFile( getAppConfigPath(), JSON.stringify( config, null, 2 ) + '\n', 'utf-8' );
	},
};
