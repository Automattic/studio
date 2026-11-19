import { formatDbHost, parseDbHost, type MysqlConnection } from '@studio/database';
import { __, sprintf } from '@wordpress/i18n';
import { defineWpConfigConstants, readWpConfigConstants } from 'cli/lib/native-php/site-setup';
import { LoggerError } from 'cli/logger';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

const DB_CONSTANTS = [ 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME' ] as const;

/** The connection the site's wp-config.php defines, the one source of truth for it. */
export async function readMysqlConnection(
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
		engine: 'mysql',
		...parseDbHost( String( constants.DB_HOST ) ),
		user: String( constants.DB_USER ),
		password: String( constants.DB_PASSWORD ?? '' ),
		database: String( constants.DB_NAME ),
	};
}

/** Points the site's wp-config.php at the MySQL database. */
export async function writeMysqlConfig(
	sitePath: string,
	phpVersion: SupportedPHPVersion,
	connection: MysqlConnection
): Promise< void > {
	await defineWpConfigConstants( sitePath, phpVersion, {
		DB_HOST: formatDbHost( connection ),
		DB_USER: connection.user,
		DB_PASSWORD: connection.password,
		DB_NAME: connection.database,
	} );
}
