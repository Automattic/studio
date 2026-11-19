import { __, sprintf } from '@wordpress/i18n';
import { formatDbHost } from './connection';
import { DatabaseError } from './errors';
import type { DatabaseConnection } from './connection';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record< string, unknown >;

/** An open database. Close it when done, or open it with `await using`. */
export interface DatabaseSession extends AsyncDisposable {
	readonly connection: DatabaseConnection;
	/** Runs one statement, with `?` placeholders for `params`, and returns the rows it selects. */
	query< T extends Row = Row >( sql: string, params?: SqlValue[] ): Promise< T[] >;
	/** Like `query`, but yields the rows one at a time, for tables too large to hold in memory. */
	rows< T extends Row = Row >( sql: string, params?: SqlValue[] ): AsyncIterable< T >;
	/** Every table, by name. On SQLite, that includes the SQLite driver's own tables. */
	tables(): Promise< string[] >;
	/** A table's rows, one at a time, in an order that stays the same while they don't change. */
	tableRows( table: string ): AsyncIterable< Row >;
	close(): Promise< void >;
}

/** What each engine implements; `createSession` adds the error handling around it. */
export interface Driver {
	query( sql: string, params: SqlValue[] ): Promise< Row[] >;
	rows( sql: string, params: SqlValue[] ): AsyncIterable< Row >;
	tables(): Promise< string[] >;
	tableRowsSql( table: string ): Promise< string >;
	close(): Promise< void >;
}

export async function openDriver(
	connection: DatabaseConnection,
	open: () => Promise< Driver >
): Promise< DatabaseSession > {
	let driver: Driver;
	try {
		driver = await open();
	} catch ( error ) {
		throw new DatabaseError(
			describeConnectionFailure( connection, errorMessage( error ) ),
			'connection_failed',
			{ cause: error }
		);
	}
	return createSession( connection, driver );
}

function createSession( connection: DatabaseConnection, driver: Driver ): DatabaseSession {
	const run = async < T >( action: () => Promise< T > ): Promise< T > => {
		try {
			return await action();
		} catch ( error ) {
			throw queryFailed( error );
		}
	};
	async function* stream< T >( rows: () => AsyncIterable< T > ): AsyncIterable< T > {
		try {
			yield* rows();
		} catch ( error ) {
			throw queryFailed( error );
		}
	}
	return {
		connection,
		query: < T extends Row >( sql: string, params: SqlValue[] = [] ) =>
			run( () => driver.query( sql, params ) as Promise< T[] > ),
		rows: < T extends Row >( sql: string, params: SqlValue[] = [] ) =>
			stream( () => driver.rows( sql, params ) as AsyncIterable< T > ),
		tables: () => run( () => driver.tables() ),
		tableRows: ( table: string ) =>
			stream( async function* () {
				yield* driver.rows( await driver.tableRowsSql( table ), [] );
			} ),
		close: () => driver.close(),
		[ Symbol.asyncDispose ]: () => driver.close(),
	};
}

function queryFailed( error: unknown ): DatabaseError {
	return new DatabaseError(
		// translators: %s is the database's error message
		sprintf( __( 'The database query failed: %s' ), errorMessage( error ) ),
		'query_failed',
		{ cause: error }
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
