import fs from 'fs';
import path from 'path';

/**
 * Switches a site's imported SQLite database out of WAL journal mode and into
 * the rollback (DELETE) journal mode that Playground expects when it boots.
 *
 * The database import runs through the SQLite driver, whose connection defaults
 * to WAL mode ("PRAGMA journal_mode = WAL"), and WAL is persisted in the
 * database file header. When Playground later boots the site it opens the
 * database through PHP-WASM. On Windows, PHP-WASM cannot back WAL's
 * shared-memory index, so opening a WAL database fails intermittently with
 * "database is locked" — surfaced to the user as "Error connecting to the
 * SQLite database" and a failed server (re)start after an import.
 *
 * Node's built-in SQLite is native, so it is unaffected by that PHP-WASM
 * limitation: it checkpoints the WAL and rewrites the header back to rollback
 * mode, leaving a database Playground can reliably reopen.
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
		// Never fail the import over this: the imported data is already on disk.
		// Skipping the conversion only leaves the pre-existing boot failure this
		// guards against, so log and move on rather than aborting the import.
		console.error( 'Failed to reset the imported SQLite database journal mode:', error );
	}
}
