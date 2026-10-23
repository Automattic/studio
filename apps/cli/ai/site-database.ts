import { existsSync, readFileSync } from 'fs';
import path from 'path';

// A Studio site's database is SQLite, at wp-content/database/.ht.sqlite.
// Studio reads it directly, read-only, to state facts about the site without
// starting it.

export interface SiteDatabase {
	prepare( sql: string ): {
		all( ...params: unknown[] ): unknown[];
		get( ...params: unknown[] ): unknown;
	};
}

// The table prefix wp-config.php sets; imported sites can use one other than wp_.
function tablePrefix( root: string ): string {
	try {
		const config = readFileSync( path.join( root, 'wp-config.php' ), 'utf8' );
		return config.match( /\$table_prefix\s*=\s*['"]([A-Za-z0-9_]+)['"]/ )?.[ 1 ] ?? 'wp_';
	} catch {
		return 'wp_';
	}
}

/**
 * Runs `query` on the database of the WordPress install at `root`, with its
 * table prefix. Undefined when the site has no readable database or the query
 * fails: a fact that cannot be read is not stated.
 */
export async function readSiteDatabase< T >(
	root: string,
	query: ( db: SiteDatabase, prefix: string ) => T
): Promise< T | undefined > {
	const dbPath = path.join( root, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! existsSync( dbPath ) ) {
		return undefined;
	}
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( dbPath, { readOnly: true } );
		try {
			return query( db as unknown as SiteDatabase, tablePrefix( root ) );
		} finally {
			db.close();
		}
	} catch {
		return undefined;
	}
}

/** The values of these options, by name; a missing option is left out. */
export function readOptions(
	db: SiteDatabase,
	prefix: string,
	names: string[]
): Record< string, string > {
	const rows = db
		.prepare(
			`SELECT option_name AS name, option_value AS value FROM ${ prefix }options WHERE option_name IN ( ${ names
				.map( () => '?' )
				.join( ', ' ) } )`
		)
		.all( ...names ) as Array< { name: string; value: string } >;
	return Object.fromEntries( rows.map( ( row ) => [ row.name, row.value ] ) );
}
