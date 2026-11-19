import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { DatabaseError } from './errors';

export const sqliteConnectionSchema = z.object( {
	engine: z.literal( 'sqlite' ),
	path: z.string(),
} );

export const mysqlConnectionSchema = z.object( {
	engine: z.literal( 'mysql' ),
	host: z.string(),
	port: z.number().int(),
	user: z.string(),
	password: z.string(),
	database: z.string(),
} );

/** Where a database is: a SQLite file, or a database on a MySQL server. */
export const databaseConnectionSchema = z.discriminatedUnion( 'engine', [
	sqliteConnectionSchema,
	mysqlConnectionSchema,
] );

export type SqliteConnection = z.infer< typeof sqliteConnectionSchema >;
export type MysqlConnection = z.infer< typeof mysqlConnectionSchema >;
export type DatabaseConnection = z.infer< typeof databaseConnectionSchema >;

// Not `localhost`, which PHP's MySQL driver takes as a socket connection.
export const DEFAULT_MYSQL_HOST = '127.0.0.1';
export const DEFAULT_MYSQL_PORT = 3306;

/**
 * Splits a WordPress `DB_HOST` value, `host` or `host:port`, into its parts. Sockets
 * (`localhost:/path/to.sock`) aren't supported, and neither is `localhost`, which PHP's MySQL
 * driver takes as a socket even with a port: WordPress has to connect over TCP.
 */
export function parseDbHost( dbHost: string ): Pick< MysqlConnection, 'host' | 'port' > {
	const [ , host = '', port ] = /^(.*?)(?::(\d+))?$/.exec( dbHost.trim() ) ?? [];
	if ( host === 'localhost' || ( host.includes( ':' ) && ! host.startsWith( '[' ) ) ) {
		throw new DatabaseError(
			sprintf(
				// translators: %s is a database host, e.g. "localhost:/tmp/mysql.sock"
				__(
					'WordPress in Studio connects to MySQL over TCP, so it can’t use "%s". Use 127.0.0.1.'
				),
				dbHost
			),
			'socket_host'
		);
	}
	return { host: host || DEFAULT_MYSQL_HOST, port: port ? Number( port ) : DEFAULT_MYSQL_PORT };
}

/** The `DB_HOST` value for a host and port, leaving out the default port. */
export function formatDbHost( { host, port }: Pick< MysqlConnection, 'host' | 'port' > ): string {
	return port === DEFAULT_MYSQL_PORT ? host : `${ host }:${ port }`;
}
