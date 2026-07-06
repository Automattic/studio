import fs from 'fs';
import path from 'path';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';

const RETENTION_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Matches both legacy (`{name}-{out|error}.log`) and dated
// (`{name}-{out|error}-YYYYMMDD.log`) process manager log files.
const LOG_FILE_REGEX = /^.+-(?:out|error)(?:-\d{8})?\.log$/;

export async function prunePmLogs(): Promise< void > {
	let entries: string[];
	try {
		entries = await fs.promises.readdir( PROCESS_MANAGER_LOGS_DIR );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return;
		}
		throw error;
	}

	const cutoff = Date.now() - RETENTION_DAYS * MS_PER_DAY;
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

	await Promise.all(
		stale.map( ( filePath ) =>
			fs.promises.unlink( filePath ).catch( () => {
				// Ignore — file may have been removed concurrently.
			} )
		)
	);
}
