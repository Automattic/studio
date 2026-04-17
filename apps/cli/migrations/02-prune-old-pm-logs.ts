import fs from 'fs';
import path from 'path';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';
import type { Migration } from '@studio/common/lib/migration';

const RETENTION_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Matches both legacy (`{name}-{out|error}.log`) and dated
// (`{name}-{out|error}-YYYYMMDD.log`) log files.
const LOG_FILE_REGEX = /^.+-(?:out|error)(?:-\d{8})?\.log$/;

async function readLogsDir(): Promise< string[] > {
	try {
		return await fs.promises.readdir( PROCESS_MANAGER_LOGS_DIR );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return [];
		}
		throw error;
	}
}

async function findStalePmLogs( now: number ): Promise< string[] > {
	const entries = await readLogsDir();
	const cutoff = now - RETENTION_DAYS * MS_PER_DAY;
	const stale: string[] = [];

	for ( const entry of entries ) {
		if ( ! LOG_FILE_REGEX.test( entry ) ) {
			continue;
		}
		const fullPath = path.join( PROCESS_MANAGER_LOGS_DIR, entry );
		try {
			const stats = await fs.promises.stat( fullPath );
			if ( stats.mtimeMs < cutoff ) {
				stale.push( fullPath );
			}
		} catch {
			// File disappeared between readdir and stat — skip.
		}
	}

	return stale;
}

export const pruneOldPmLogs: Migration = {
	async needsToRun() {
		const stale = await findStalePmLogs( Date.now() );
		return stale.length > 0;
	},
	async run() {
		const stale = await findStalePmLogs( Date.now() );
		await Promise.all(
			stale.map( ( filePath ) =>
				fs.promises.unlink( filePath ).catch( () => {
					// Ignore — file may have been removed concurrently.
				} )
			)
		);
	},
};
