import fs from 'fs';
import path from 'path';

/**
 * Switches a site's SQLite database out of WAL journal mode and into the
 * rollback (DELETE) journal mode that Playground expects when it boots.
 *
 * Since sqlite-database-integration v3.0.0 the driver connects in WAL mode by
 * default, so any boot that writes to the database persists WAL in the file
 * header — not just imports. WAL needs a shared-memory index (the "-shm" file),
 * which SQLite acquires through file locks. Under PHP-WASM those locks are
 * emulated by the host (see FileLockManagerForWindows/Posix in @php-wasm/node),
 * and on Windows that emulation maps onto real LockFileEx/UnlockFileEx calls
 * released only during orderly cleanup — so a lock outliving its process, or
 * contention between the old and new server around a restart, makes reopening
 * a WAL database fail intermittently with "database is locked".
 *
 * The driver swallows that failure (wpdb::bail() only calls wp_die() when
 * show_errors is on, and it defaults to off), leaving $wpdb->dbh null;
 * WordPress then crashes further into boot with "Cannot escape data without an
 * active database connection".
 *
 * Native PHP is unaffected: it uses the platform's own SQLite against real OS
 * locks, with no emulation layer in between. Node's built-in SQLite is native
 * for the same reason, so it can checkpoint the WAL here and rewrite the header
 * back to rollback mode, leaving a database Playground can reliably reopen.
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
