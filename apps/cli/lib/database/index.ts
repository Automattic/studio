import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { type DatabaseConnection, type DatabaseEngine } from '@studio/database';
import { createDatabase, type Database } from '@studio/database/node';
import { __ } from '@wordpress/i18n';
import { readMysqlConnection } from 'cli/lib/database/mysql';
import {
	getSqliteDatabasePath,
	updateSqliteIntegration,
} from 'cli/lib/database/sqlite-integration';
import { LoggerError, type Logger } from 'cli/logger';

interface DatabaseSite {
	path: string;
	phpVersion?: string;
	databaseEngine?: DatabaseEngine;
}

/** Studio records the engine only for sites on a MySQL server, so every other site runs on SQLite. */
export function getDatabaseEngine( site: { databaseEngine?: DatabaseEngine } ): DatabaseEngine {
	return site.databaseEngine ?? 'sqlite';
}

/** Where a site's database is: its SQLite file, or the MySQL database its wp-config.php names. */
export async function getSiteDatabaseConnection(
	site: DatabaseSite
): Promise< DatabaseConnection > {
	return getDatabaseEngine( site ) === 'mysql'
		? readMysqlConnection( site.path, resolveSupportedPhpVersion( site.phpVersion ?? '' ) )
		: { engine: 'sqlite', path: getSqliteDatabasePath( site.path ) };
}

export async function getSiteDatabase( site: DatabaseSite ): Promise< Database > {
	return createDatabase( await getSiteDatabaseConnection( site ) );
}

/**
 * Gets a site's database ready for WordPress to run on it: on SQLite, the integration WordPress
 * runs on it through; on MySQL, a check that the database can be opened.
 */
export async function ensureSiteDatabaseReady< Action extends string >(
	site: DatabaseSite,
	logger: Logger< Action >,
	action: Action
): Promise< void > {
	logger.reportStart( action, __( 'Preparing the database…' ) );
	if ( getDatabaseEngine( site ) === 'mysql' ) {
		await ( await ( await getSiteDatabase( site ) ).open() ).close();
	} else {
		// Also leaves alone the sites people moved to their own database server by hand before
		// Studio supported MySQL: they have a wp-config.php and none of the SQLite files.
		await updateSqliteIntegration( site.path );
	}
	logger.reportSuccess( __( 'Database ready' ) );
}

/**
 * Import, export, push, pull and previews move the database as SQL or as a SQLite file, which
 * Studio can only do on SQLite for now.
 */
export function assertDatabaseCanBeTransferred( site: DatabaseSite ): void {
	if ( getDatabaseEngine( site ) === 'mysql' ) {
		throw new LoggerError(
			__(
				'Studio can’t import, export, push, pull or preview a site that uses a MySQL server yet.'
			)
		);
	}
}
