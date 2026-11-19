import fs from 'node:fs';
import { openDatabase } from './open';

/**
 * Switches a SQLite database out of WAL journal mode and into the rollback (DELETE) mode.
 *
 * Since sqlite-database-integration v3.0.0 the driver connects in WAL mode, so any boot that writes
 * to the database persists WAL in the file header. WAL needs a shared-memory index (the "-shm"
 * file), acquired through file locks, and several processes share one site's database — an export
 * runs a WP-CLI process per table while the site keeps serving — so reopening a WAL database fails
 * intermittently with "database is locked". The driver swallows that failure, leaving $wpdb->dbh
 * null, and WordPress crashes later in boot with "Cannot escape data without an active database
 * connection".
 *
 * Never throws: skipping it only leaves that failure possible, which mustn't block a start or an
 * import.
 */
export async function resetSqliteJournalMode( databasePath: string ): Promise< void > {
	if ( ! fs.existsSync( databasePath ) ) {
		return;
	}
	try {
		await using database = await openDatabase( { engine: 'sqlite', path: databasePath } );
		await database.query( 'PRAGMA wal_checkpoint(TRUNCATE)' );
		await database.query( 'PRAGMA journal_mode = DELETE' );
	} catch ( error ) {
		console.error( 'Failed to reset the SQLite database journal mode:', error );
	}
}

const MYSQL8_COLLATION_COLUMNS = [
	{ table: '_wp_sqlite_mysql_information_schema_schemata', column: 'DEFAULT_COLLATION_NAME' },
	{ table: '_wp_sqlite_mysql_information_schema_tables', column: 'TABLE_COLLATION' },
	{ table: '_wp_sqlite_mysql_information_schema_columns', column: 'COLLATION_NAME' },
];

/**
 * Replaces MySQL 8-only `utf8mb4_*0900*` collations recorded in the SQLite driver's information
 * schema with `utf8mb4_unicode_ci` (or `utf8mb4_bin`).
 *
 * The driver records `utf8mb4_0900_ai_ci` for any table created without an explicit collation,
 * which includes plugin tables created through `$wpdb->get_charset_collate()` because the driver
 * leaves `$wpdb->collate` empty. `SHOW CREATE TABLE` then emits it in database exports, and
 * MariaDB (WordPress.com, Pressable) rejects it, failing the import on the live site. Collations
 * are metadata only in SQLite, so rewriting them doesn't change query behavior.
 *
 * Never throws: a failure only leaves those collations in place.
 */
export async function replaceMysql8OnlyCollations( databasePath: string ): Promise< void > {
	if ( ! fs.existsSync( databasePath ) ) {
		return;
	}
	try {
		await using database = await openDatabase( { engine: 'sqlite', path: databasePath } );
		const tables = new Set(
			(
				await database.query< { name: string } >(
					"SELECT name FROM sqlite_master WHERE type = 'table'"
				)
			).map( ( { name } ) => name )
		);
		for ( const { table, column } of MYSQL8_COLLATION_COLUMNS ) {
			if ( tables.has( table ) ) {
				await database.query(
					`UPDATE "${ table }"
					SET "${ column }" = CASE
						WHEN "${ column }" LIKE '%\\_bin' ESCAPE '\\' THEN 'utf8mb4_bin'
						ELSE 'utf8mb4_unicode_ci'
					END
					WHERE "${ column }" LIKE 'utf8mb4\\_%0900\\_%' ESCAPE '\\'`
				);
			}
		}
	} catch ( error ) {
		console.error( 'Failed to replace MySQL 8-only collations:', error );
	}
}

/**
 * Copies a SQLite database into a single file in rollback journal mode. The copy is consistent
 * even while a site writes to the source, possibly in WAL mode.
 */
export async function copySqliteDatabase( source: string, destination: string ): Promise< void > {
	{
		await using database = await openDatabase(
			{ engine: 'sqlite', path: source },
			{ readOnly: true }
		);
		await database.query( 'VACUUM INTO ?', [ destination ] );
	}
	await using copy = await openDatabase( { engine: 'sqlite', path: destination } );
	await copy.query( 'PRAGMA journal_mode = DELETE' );
}
