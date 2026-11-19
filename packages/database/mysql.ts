import { openDriver } from './session';
import type { MysqlConnection } from './connection';
import type { Database } from './database';
import type { DatabaseSession, Driver, Row } from './session';

const quote = ( identifier: string ) => `\`${ identifier.replace( /`/g, '``' ) }\``;

export function createMysqlDatabase( connection: MysqlConnection ): Database {
	// The server without selecting a database, to check for the database or create it.
	const openServer = () => openMysql( { ...connection, database: '' } );
	return {
		connection,
		async exists() {
			await using server = await openServer();
			const rows = await server.query(
				'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
				[ connection.database ]
			);
			return rows.length > 0;
		},
		async create() {
			await using server = await openServer();
			await server.query( `CREATE DATABASE IF NOT EXISTS ${ quote( connection.database ) }` );
		},
		open: () => openMysql( connection ),
		repair: async () => {},
		prepareForSharing: async () => {},
	};
}

function openMysql( connection: MysqlConnection ): Promise< DatabaseSession > {
	return openDriver( connection, async (): Promise< Driver > => {
		const { createConnection } = await import( 'mysql2' );
		// The callback connection streams rows; its promise wrapper runs everything else.
		const streaming = createConnection( {
			host: connection.host,
			port: connection.port,
			user: connection.user,
			password: connection.password,
			database: connection.database || undefined,
			charset: 'utf8mb4',
			// Dates as MySQL stores them, not shifted into the local time zone.
			dateStrings: true,
		} );
		const database = streaming.promise();
		await database.connect();
		const query = async ( sql: string, params: unknown[] = [] ) => {
			const [ rows ] = await database.query( sql, params );
			return Array.isArray( rows ) ? ( rows as Row[] ) : [];
		};
		return {
			query,
			async *rows( sql, params ) {
				yield* streaming.query( sql, params ).stream() as AsyncIterable< Row >;
			},
			tables: async () =>
				(
					( await query(
						"SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
					) ) as { name: string }[]
				 ).map( ( { name } ) => name ),
			async tableRowsSql( table ) {
				const keys = ( await query(
					"SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
					[ table ]
				) ) as { name: string }[];
				const order = keys.length
					? ` ORDER BY ${ keys.map( ( { name } ) => quote( name ) ).join( ', ' ) }`
					: '';
				return `SELECT * FROM ${ quote( table ) }${ order }`;
			},
			close: () => database.end(),
		};
	} );
}
