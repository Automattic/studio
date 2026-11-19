import { __, sprintf } from '@wordpress/i18n';
import { formatDbHost } from './connection';
import { DatabaseError } from './errors';
import type { DatabaseConnection, MysqlConnection, SqliteConnection } from './connection';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record< string, unknown >;

/** An open database. Close it when done, or open it with `await using`. */
export interface Database extends AsyncDisposable {
	readonly connection: DatabaseConnection;
	/** Runs one statement, with `?` placeholders for `params`, and returns the rows it selects. */
	query< T extends Row = Row >( sql: string, params?: SqlValue[] ): Promise< T[] >;
	/** Like `query`, but yields the rows one at a time, for tables too large to hold in memory. */
	rows< T extends Row = Row >( sql: string, params?: SqlValue[] ): AsyncIterable< T >;
	close(): Promise< void >;
}

export interface OpenDatabaseOptions {
	/** Opens a SQLite file read-only, so a missing file fails instead of being created. */
	readOnly?: boolean;
}

interface Driver {
	query( sql: string, params: SqlValue[] ): Promise< Row[] >;
	rows( sql: string, params: SqlValue[] ): AsyncIterable< Row >;
	close(): Promise< void >;
}

// A site that is running writes to its SQLite file: wait for the write instead of failing.
const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Opens a SQLite file or connects to a MySQL server. Throws a `connection_failed` DatabaseError. */
export async function openDatabase(
	connection: DatabaseConnection,
	options: OpenDatabaseOptions = {}
): Promise< Database > {
	let driver: Driver;
	try {
		driver =
			connection.engine === 'sqlite'
				? await openSqlite( connection, options )
				: await openMysql( connection );
	} catch ( error ) {
		throw new DatabaseError(
			describeConnectionFailure( connection, errorMessage( error ) ),
			'connection_failed',
			{
				cause: error,
			}
		);
	}

	const queryFailed = ( error: unknown ) =>
		new DatabaseError(
			// translators: %s is the database's error message
			sprintf( __( 'The database query failed: %s' ), errorMessage( error ) ),
			'query_failed',
			{ cause: error }
		);
	return {
		connection,
		async query< T extends Row >( sql: string, params: SqlValue[] = [] ) {
			try {
				return ( await driver.query( sql, params ) ) as T[];
			} catch ( error ) {
				throw queryFailed( error );
			}
		},
		async *rows< T extends Row >( sql: string, params: SqlValue[] = [] ) {
			try {
				yield* driver.rows( sql, params ) as AsyncIterable< T >;
			} catch ( error ) {
				throw queryFailed( error );
			}
		},
		close: () => driver.close(),
		[ Symbol.asyncDispose ]: () => driver.close(),
	};
}

async function openSqlite(
	connection: SqliteConnection,
	{ readOnly = false }: OpenDatabaseOptions
): Promise< Driver > {
	const { DatabaseSync } = await import( 'node:sqlite' );
	const database = new DatabaseSync( connection.path, {
		readOnly,
		timeout: SQLITE_BUSY_TIMEOUT_MS,
	} );
	return {
		query: async ( sql, params ) => database.prepare( sql ).all( ...params ),
		async *rows( sql, params ) {
			yield* database.prepare( sql ).iterate( ...params );
		},
		close: async () => database.close(),
	};
}

async function openMysql( connection: MysqlConnection ): Promise< Driver > {
	const { createConnection } = await import( 'mysql2' );
	const connectionWithStreams = createConnection( {
		host: connection.host,
		port: connection.port,
		user: connection.user,
		password: connection.password,
		database: connection.database || undefined,
		charset: 'utf8mb4',
		// Dates as MySQL stores them, not shifted into the local time zone.
		dateStrings: true,
	} );
	const database = connectionWithStreams.promise();
	await database.connect();
	return {
		async query( sql, params ) {
			const [ rows ] = await database.query( sql, params );
			return Array.isArray( rows ) ? ( rows as Row[] ) : [];
		},
		async *rows( sql, params ) {
			yield* connectionWithStreams.query( sql, params ).stream() as AsyncIterable< Row >;
		},
		close: () => database.end(),
	};
}

/**
 * Creates the connection's database on its MySQL server, unless it exists already.
 * Throws a `connection_failed` DatabaseError when the server can't be reached.
 */
export async function createMysqlDatabase( connection: MysqlConnection ): Promise< void > {
	await using server = await openDatabase( { ...connection, database: '' } );
	await server.query(
		`CREATE DATABASE IF NOT EXISTS \`${ connection.database.replace( /`/g, '``' ) }\``
	);
}

function describeConnectionFailure( connection: DatabaseConnection, reason: string ): string {
	if ( connection.engine === 'sqlite' ) {
		// translators: 1: path of a SQLite database file, 2: the reason it can't be opened
		return sprintf( __( 'Can’t open the database %1$s: %2$s' ), connection.path, reason );
	}
	if ( ! connection.database ) {
		return sprintf(
			// translators: 1: MySQL host and port, e.g. "127.0.0.1:3307", 2: the reason it failed
			__( 'Can’t connect to the MySQL server at %1$s: %2$s' ),
			formatDbHost( connection ),
			reason
		);
	}
	return sprintf(
		// translators: 1: database name, 2: MySQL host and port, e.g. "127.0.0.1:3307", 3: the reason
		__( 'Can’t open the MySQL database "%1$s" on %2$s: %3$s' ),
		connection.database,
		formatDbHost( connection ),
		reason
	);
}

function errorMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}
