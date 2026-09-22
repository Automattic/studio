import fs from 'fs';
import path from 'path';

/**
 * Checkpoints a site's SQLite database and rewrites its header from WAL to
 * rollback (DELETE) journal mode.
 *
 * New connections pin the mode via SQLITE_JOURNAL_MODE, so this is the repair
 * path for databases an older build already left in WAL — reopening one fails
 * intermittently with "database is locked", which the driver swallows into a
 * later "Cannot escape data without an active database connection".
 */
export async function resetSqliteJournalModeToRollback( sitePath: string ): Promise< void > {
	const dbPath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! fs.existsSync( dbPath ) ) {
		return;
	}

	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( dbPath );
		try {
			database.exec( 'PRAGMA wal_checkpoint(TRUNCATE)' );
			database.exec( 'PRAGMA journal_mode = DELETE' );
		} finally {
			database.close();
		}
	} catch ( error ) {
		// Never fail the caller over this: skipping the conversion only leaves the
		// pre-existing boot failure this guards against, so log and move on rather
		// than blocking an import or a site start.
		console.error( 'Failed to reset the SQLite database journal mode:', error );
	}
}
