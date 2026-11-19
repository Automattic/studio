import { DEFAULT_MYSQL_HOST } from '@studio/common/lib/site-database';
import { __, sprintf } from '@wordpress/i18n';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import { PhpCommandError, runPhpCommand } from 'cli/lib/native-php/php-process';
import { defineWpConfigConstants, readWpConfigConstants } from 'cli/lib/native-php/site-setup';
import { LoggerError } from 'cli/logger';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { SiteDatabase } from 'cli/lib/database';

export interface MysqlConnection {
	host: string;
	port: number;
	user: string;
	password: string;
	name: string;
}

const DEFAULT_MYSQL_PORT = 3306;

/**
 * Splits a WordPress DB_HOST value, `host` or `host:port`, into its parts. Sockets
 * (`host:/path/to.sock`) aren't supported: Studio's PHP and the tools that write the
 * database connect over TCP.
 */
export function parseMysqlHost( dbHost: string ): Pick< MysqlConnection, 'host' | 'port' > {
	const match = /^(.*?)(?::(\d+))?$/.exec( dbHost.trim() );
	const host = match?.[ 1 ] || DEFAULT_MYSQL_HOST;
	if ( host.includes( ':' ) && ! host.startsWith( '[' ) ) {
		throw new LoggerError(
			sprintf(
				// translators: %s is the database host from wp-config.php, e.g. "localhost:/tmp/mysql.sock"
				__( 'Studio connects to MySQL over TCP and can’t use the socket in "%s".' ),
				dbHost
			)
		);
	}
	return { host, port: match?.[ 2 ] ? Number( match[ 2 ] ) : DEFAULT_MYSQL_PORT };
}

export function formatMysqlHost( { host, port }: Pick< MysqlConnection, 'host' | 'port' > ) {
	return port === DEFAULT_MYSQL_PORT ? host : `${ host }:${ port }`;
}

const CONNECT_SCRIPT = `
mysqli_report( MYSQLI_REPORT_OFF );
$c = json_decode( getenv( 'STUDIO_MYSQL_CONNECTION' ), true );
$db = @new mysqli( $c['host'], $c['user'], $c['password'], '', $c['port'] );
if ( $db->connect_errno ) {
	fwrite( STDERR, $db->connect_error );
	exit( 1 );
}
$ok = $c['create']
	? $db->query( 'CREATE DATABASE IF NOT EXISTS \`' . str_replace( '\`', '\`\`', $c['name'] ) . '\`' )
	: $db->select_db( $c['name'] );
if ( ! $ok ) {
	fwrite( STDERR, $db->error );
	exit( 1 );
}
`;

/**
 * Connects to the server and opens the database, or creates it with `createDatabase`.
 * The credentials go through the environment so they don't show in the process list.
 */
export async function connectToMysql(
	connection: MysqlConnection,
	phpVersion: SupportedPHPVersion,
	{ createDatabase = false }: { createDatabase?: boolean } = {}
): Promise< void > {
	await ensurePhpBinaryAvailable( phpVersion );
	try {
		await runPhpCommand( [ '-r', CONNECT_SCRIPT ], {
			phpVersion,
			mode: 'capture',
			env: {
				STUDIO_MYSQL_CONNECTION: JSON.stringify( { ...connection, create: createDatabase } ),
			},
		} );
	} catch ( error ) {
		const reason = error instanceof PhpCommandError ? error.stderr.trim() : String( error );
		throw new LoggerError(
			sprintf(
				// translators: 1: database name, 2: MySQL host and port, 3: the server's error message
				__( 'Can’t open the MySQL database "%1$s" on %2$s: %3$s' ),
				connection.name,
				formatMysqlHost( connection ),
				connection.host === 'localhost'
					? `${ reason } (${ __( 'Use 127.0.0.1 instead of localhost.' ) })`
					: reason
			)
		);
	}
}

const DB_CONSTANTS = [ 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME' ] as const;

/** The connection the site's wp-config.php defines, the one source of truth for it. */
async function readMysqlConnection(
	sitePath: string,
	phpVersion: SupportedPHPVersion
): Promise< MysqlConnection > {
	const constants = await readWpConfigConstants( sitePath, phpVersion, DB_CONSTANTS );
	const missing = DB_CONSTANTS.filter(
		( name ) => constants[ name ] === null && name !== 'DB_PASSWORD'
	);
	if ( missing.length > 0 ) {
		throw new LoggerError(
			sprintf(
				// translators: %s is a list of constant names, e.g. "DB_HOST, DB_USER"
				__( 'wp-config.php must define %s as plain values for Studio to use the MySQL server.' ),
				missing.join( ', ' )
			)
		);
	}
	return {
		...parseMysqlHost( String( constants.DB_HOST ) ),
		user: String( constants.DB_USER ),
		password: String( constants.DB_PASSWORD ?? '' ),
		name: String( constants.DB_NAME ),
	};
}

/** Points the site's wp-config.php at the MySQL database. */
export async function writeMysqlConfig(
	sitePath: string,
	phpVersion: SupportedPHPVersion,
	connection: MysqlConnection
): Promise< void > {
	await defineWpConfigConstants( sitePath, phpVersion, {
		DB_HOST: formatMysqlHost( connection ),
		DB_USER: connection.user,
		DB_PASSWORD: connection.password,
		DB_NAME: connection.name,
	} );
}

export function createMysqlDatabase( sitePath: string, phpVersion: SupportedPHPVersion ) {
	return {
		engine: 'mysql',
		async ensureReady() {
			await connectToMysql( await readMysqlConnection( sitePath, phpVersion ), phpVersion );
		},
		async getConnection() {
			return { engine: 'mysql', ...( await readMysqlConnection( sitePath, phpVersion ) ) };
		},
	} satisfies SiteDatabase;
}
