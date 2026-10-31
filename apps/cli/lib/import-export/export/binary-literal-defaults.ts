import fs from 'fs';
import { pipeline } from 'node:stream/promises';
import readline from 'readline';
import { getSiteDatabasePath } from 'cli/lib/sqlite-collations';

// The SQLite driver stores a hex or bit default of a BINARY or VARBINARY column as written, and
// SHOW CREATE TABLE then quotes it as text: `DEFAULT 'x''00'''`. MySQL and MariaDB reject that when
// the text is longer than the column, failing the import on the live site, and otherwise store the
// text instead of the bytes. Dumps escape newlines in values, so a line that starts with an
// indented column name is always a column definition, never row data.
// This can go once sqlite-database-integration writes these defaults unquoted.
const QUOTED_BINARY_LITERAL_DEFAULT =
	/^(\s+`[^`]+` (?:var)?binary\(\d+\)[^']* DEFAULT )'(0x[\da-f]+|[xb]''[\da-f]*'')'/i;

/**
 * The tables to pass through `restoreBinaryLiteralDefaults`. The database is read rather than the
 * dump so that the exports of every other site aren't rewritten. Returns an empty set when the
 * database can't be read, which leaves the dump as WP-CLI wrote it.
 */
export async function getTablesWithBinaryLiteralDefaults(
	sitePath: string
): Promise< Set< string > > {
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( getSiteDatabasePath( sitePath ), { readOnly: true } );
		try {
			const rows = database
				.prepare(
					`SELECT DISTINCT TABLE_NAME FROM _wp_sqlite_mysql_information_schema_columns
					WHERE DATA_TYPE IN ('binary', 'varbinary')
					AND ( COLUMN_DEFAULT LIKE '0x%' OR COLUMN_DEFAULT LIKE 'x''%' OR COLUMN_DEFAULT LIKE 'b''%' )`
				)
				.all() as { TABLE_NAME: string }[];
			return new Set( rows.map( ( { TABLE_NAME } ) => TABLE_NAME ) );
		} finally {
			database.close();
		}
	} catch {
		return new Set();
	}
}

export async function restoreBinaryLiteralDefaults( dumpPath: string ): Promise< void > {
	const restoredPath = `${ dumpPath }.restored`;
	// latin1 maps each byte to one character, so row data survives whatever its encoding.
	const lines = readline.createInterface( {
		input: fs.createReadStream( dumpPath, 'latin1' ),
		crlfDelay: Infinity,
	} );

	try {
		await pipeline( async function* () {
			for await ( const line of lines ) {
				const restored = line.replace(
					QUOTED_BINARY_LITERAL_DEFAULT,
					( _, column: string, literal: string ) => column + literal.replace( /''/g, "'" )
				);
				yield Buffer.from( `${ restored }\n`, 'latin1' );
			}
		}, fs.createWriteStream( restoredPath ) );
		await fs.promises.rename( restoredPath, dumpPath );
	} finally {
		await fs.promises.rm( restoredPath, { force: true } );
	}
}
