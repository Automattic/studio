import { existsSync, readFileSync } from 'fs';
import path from 'path';

// A Studio site read from its own files and its SQLite database
// (wp-content/database/.ht.sqlite), read-only and without starting it. Facts
// about the site (site-facts.ts) and the checks that need the site's state
// read it through here.

export interface WordPressSite {
	root: string;
	// The table prefix wp-config.php sets; imported sites can use one other than wp_.
	prefix: string;
	// An option's stored value, unserialized when WordPress serialized it.
	option( name: string ): unknown;
	// Rows of a query on the site's tables; none without a readable database.
	query< Row >( sql: string, ...params: Array< string | number > ): Row[];
}

interface Statement {
	all( ...params: unknown[] ): unknown[];
}

function tablePrefix( root: string ): string {
	try {
		const config = readFileSync( path.join( root, 'wp-config.php' ), 'utf8' );
		return config.match( /\$table_prefix\s*=\s*['"]([A-Za-z0-9_]+)['"]/ )?.[ 1 ] ?? 'wp_';
	} catch {
		return 'wp_';
	}
}

async function openDatabase(
	root: string
): Promise< { prepare( sql: string ): Statement; close(): void } | undefined > {
	const dbPath = path.join( root, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! existsSync( dbPath ) ) {
		return undefined;
	}
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		return new DatabaseSync( dbPath, { readOnly: true } );
	} catch {
		return undefined;
	}
}

/**
 * Runs `read` on the WordPress install at `root`, then closes its database.
 * A query that fails reads as no rows: a fact that cannot be read is not stated.
 */
export async function readWordPressSite< T >(
	root: string,
	read: ( site: WordPressSite ) => T | Promise< T >
): Promise< T > {
	const db = await openDatabase( root );
	const prefix = tablePrefix( root );
	const query = < Row >( sql: string, ...params: Array< string | number > ): Row[] => {
		try {
			return ( db?.prepare( sql ).all( ...params ) ?? [] ) as Row[];
		} catch {
			return [];
		}
	};
	const options = new Map< string, unknown >();
	const site: WordPressSite = {
		root,
		prefix,
		query,
		option( name ) {
			if ( ! options.has( name ) ) {
				const [ row ] = query< { value: string } >(
					`SELECT option_value AS value FROM ${ prefix }options WHERE option_name = ?`,
					name
				);
				options.set(
					name,
					row && /^[aOs]:\d+:/.test( row.value ) ? unserializePhp( row.value ) : row?.value
				);
			}
			return options.get( name );
		},
	};
	try {
		return await read( site );
	} finally {
		db?.close();
	}
}

/**
 * The value PHP's serialize() wrote, as WordPress stores arrays and objects in
 * options: arrays and objects become plain objects keyed by their keys.
 * Undefined when the text is not serialized data.
 */
function unserializePhp( text: string ): unknown {
	let at = 0;
	const read = ( until: string ) => {
		const end = text.indexOf( until, at );
		if ( end < 0 ) throw new Error( 'truncated' );
		const value = text.slice( at, end );
		at = end + until.length;
		return value;
	};
	const value = (): unknown => {
		const type = text[ at ];
		at += 2;
		switch ( type ) {
			case 'N':
				return null;
			case 'b':
				return read( ';' ) === '1';
			case 'i':
			case 'd':
				return Number( read( ';' ) );
			case 's': {
				// The length counts bytes, not characters.
				const length = Number( read( ':' ) );
				const bytes = Buffer.from( text.slice( at + 1, at + 1 + length ), 'utf8' ).subarray(
					0,
					length
				);
				const string = bytes.toString( 'utf8' );
				at += 1 + string.length + 2;
				return string;
			}
			case 'O':
				read( ':' );
				read( ':' );
				return entries();
			case 'a':
				return entries();
			default:
				throw new Error( `unsupported type ${ type }` );
		}
	};
	const entries = () => {
		const count = Number( read( ':' ) );
		at += 1;
		const result: Record< string, unknown > = {};
		for ( let i = 0; i < count; i++ ) {
			const key = String( value() );
			result[ key ] = value();
		}
		at += 1;
		return result;
	};
	try {
		return value();
	} catch {
		return undefined;
	}
}
