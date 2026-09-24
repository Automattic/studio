import fs from 'fs';
import path from 'path';

const MYSQL8_COLLATION_COLUMNS = [
	{ table: '_wp_sqlite_mysql_information_schema_schemata', column: 'DEFAULT_COLLATION_NAME' },
	{ table: '_wp_sqlite_mysql_information_schema_tables', column: 'TABLE_COLLATION' },
	{ table: '_wp_sqlite_mysql_information_schema_columns', column: 'COLLATION_NAME' },
];

/**
 * Replaces MySQL 8-only `utf8mb4_*0900*` collations recorded in the SQLite
 * driver's information schema with `utf8mb4_unicode_ci` (or `utf8mb4_bin`).
 *
 * The driver records `utf8mb4_0900_ai_ci` for any table created without an
 * explicit collation, which includes plugin tables created through
 * `$wpdb->get_charset_collate()` because the driver leaves `$wpdb->collate`
 * empty. `SHOW CREATE TABLE` then emits it in database exports, and MariaDB
 * (WordPress.com, Pressable) rejects it, failing the import on the live site.
 * Collations are metadata only in SQLite, so rewriting them doesn't change
 * query behavior.
 */
export async function replaceMysql8OnlyCollations( sitePath: string ): Promise< void > {
	const dbPath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! fs.existsSync( dbPath ) ) {
		return;
	}

	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( dbPath );
		try {
			database.exec( 'PRAGMA busy_timeout = 5000' );
			const existingTables = new Set(
				(
					database.prepare( "SELECT name FROM sqlite_master WHERE type = 'table'" ).all() as {
						name: string;
					}[]
				 ).map( ( { name } ) => name )
			);

			for ( const { table, column } of MYSQL8_COLLATION_COLUMNS ) {
				if ( ! existingTables.has( table ) ) {
					continue;
				}
				database.exec(
					`UPDATE "${ table }"
					SET "${ column }" = CASE
						WHEN "${ column }" LIKE '%\\_bin' ESCAPE '\\' THEN 'utf8mb4_bin'
						ELSE 'utf8mb4_unicode_ci'
					END
					WHERE "${ column }" LIKE 'utf8mb4\\_%0900\\_%' ESCAPE '\\'`
				);
			}
		} finally {
			database.close();
		}
	} catch ( error ) {
		console.error( 'Failed to replace MySQL 8-only collations:', error );
	}
}
