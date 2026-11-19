import fs from 'node:fs';
import path from 'node:path';
import { openDriver } from './session';
import type { SqliteConnection } from './connection';
import type { Database, OpenOptions } from './database';
import type { DatabaseSession, Driver } from './session';

// A site that is running writes to its SQLite file: wait for the write instead of failing.
const BUSY_TIMEOUT_MS = 5000;

const MYSQL8_COLLATION_COLUMNS = [
	{ table: '_wp_sqlite_mysql_information_schema_schemata', column: 'DEFAULT_COLLATION_NAME' },
	{ table: '_wp_sqlite_mysql_information_schema_tables', column: 'TABLE_COLLATION' },
	{ table: '_wp_sqlite_mysql_information_schema_columns', column: 'COLLATION_NAME' },
];

export function createSqliteDatabase( connection: SqliteConnection ): Database {
	const open = ( options: OpenOptions = {} ) => openSqlite( connection, options );

	/**
	 * Replaces the MySQL 8-only `utf8mb4_*0900*` collations recorded in the driver's information
	 * schema with `utf8mb4_unicode_ci` (or `utf8mb4_bin`). The driver records `utf8mb4_0900_ai_ci`
	 * for any table created without an explicit collation, which includes plugin tables created
	 * through `$wpdb->get_charset_collate()`, because the driver leaves `$wpdb->collate` empty.
	 * `SHOW CREATE TABLE` then emits it in exports, and MariaDB (WordPress.com, Pressable) rejects
	 * it. Collations are metadata only in SQLite, so this doesn't change how queries behave.
	 */
	async function repair() {
		if ( ! fs.existsSync( connection.path ) ) {
			return;
		}
		try {
			await using database = await open();
			const tables = new Set( await database.tables() );
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

	return {
		connection,
		exists: async () => fs.existsSync( connection.path ),
		create: async () => {
			await fs.promises.mkdir( path.dirname( connection.path ), { recursive: true } );
		},
		open,
		repair,
		/**
		 * Since sqlite-database-integration v3.0.0 the driver connects in WAL mode, so any boot that
		 * writes to the database persists WAL in the file header. WAL needs a shared-memory index
		 * (the "-shm" file), acquired through file locks, and processes sharing a site's database
		 * (an export runs a WP-CLI process per table while the site serves) then fail to reopen it
		 * intermittently with "database is locked". The driver swallows that, leaving $wpdb->dbh
		 * null, and WordPress crashes later with "Cannot escape data without an active database
		 * connection". Rollback (DELETE) mode has no shared index.
		 */
		async prepareForSharing() {
			if ( ! fs.existsSync( connection.path ) ) {
				return;
			}
			try {
				await using database = await open();
				await database.query( 'PRAGMA wal_checkpoint(TRUNCATE)' );
				await database.query( 'PRAGMA journal_mode = DELETE' );
			} catch ( error ) {
				console.error( 'Failed to reset the SQLite database journal mode:', error );
			}
			await repair();
		},
	};
}

function openSqlite(
	connection: SqliteConnection,
	{ readOnly = false }: OpenOptions
): Promise< DatabaseSession > {
	return openDriver( connection, async (): Promise< Driver > => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( connection.path, { readOnly, timeout: BUSY_TIMEOUT_MS } );
		return {
			query: async ( sql, params ) => database.prepare( sql ).all( ...params ),
			async *rows( sql, params ) {
				yield* database.prepare( sql ).iterate( ...params );
			},
			tables: async () =>
				(
					database
						.prepare(
							"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
						)
						.all() as { name: string }[]
				 ).map( ( { name } ) => name ),
			tableRowsSql: async ( table ) =>
				`SELECT * FROM "${ table.replace( /"/g, '""' ) }" ORDER BY rowid`,
			close: async () => database.close(),
		};
	} );
}

/**
 * Copies a SQLite database into a single file in rollback journal mode. The copy is consistent
 * even while a site writes to the source, possibly in WAL mode.
 */
export async function copySqliteDatabase( source: string, destination: string ): Promise< void > {
	{
		await using database = await openSqlite(
			{ engine: 'sqlite', path: source },
			{ readOnly: true }
		);
		await database.query( 'VACUUM INTO ?', [ destination ] );
	}
	await using copy = await openSqlite( { engine: 'sqlite', path: destination }, {} );
	await copy.query( 'PRAGMA journal_mode = DELETE' );
}
