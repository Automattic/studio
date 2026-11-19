import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { getDatabaseEngine, type DatabaseConnection, type DatabaseEngine } from '@studio/database';
import { __ } from '@wordpress/i18n';
import { createMysqlSiteDatabase } from 'cli/lib/database/mysql';
import { createSqliteSiteDatabase } from 'cli/lib/database/sqlite';
import { LoggerError, type Logger } from 'cli/logger';

/** The database a site runs on, so site operations don't depend on its engine. */
export interface SiteDatabase {
	readonly engine: DatabaseEngine;
	/** Gets the database ready for WordPress to run on it. */
	ensureReady(): Promise< void >;
	/** What the tools that write the database (Blueprints, Reprint) connect to. */
	getConnection(): Promise< DatabaseConnection >;
}

interface DatabaseSite {
	path: string;
	phpVersion?: string;
	databaseEngine?: DatabaseEngine;
}

export function getSiteDatabase( site: DatabaseSite ): SiteDatabase {
	return getDatabaseEngine( site ) === 'mysql'
		? createMysqlSiteDatabase( site.path, resolveSupportedPhpVersion( site.phpVersion ?? '' ) )
		: createSqliteSiteDatabase( site.path );
}

export async function ensureSiteDatabaseReady< Action extends string >(
	site: DatabaseSite,
	logger: Logger< Action >,
	action: Action
): Promise< void > {
	logger.reportStart( action, __( 'Preparing the database…' ) );
	await getSiteDatabase( site ).ensureReady();
	logger.reportSuccess( __( 'Database ready' ) );
}

/**
 * Import, export, push and pull move the database as SQL, which Studio can only read and
 * write on SQLite for now.
 */
export function assertDatabaseCanBeTransferred( site: DatabaseSite ): void {
	if ( getDatabaseEngine( site ) === 'mysql' ) {
		throw new LoggerError(
			__( 'Studio can’t import, export, push or pull a site that uses a MySQL server yet.' )
		);
	}
}
