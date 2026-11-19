import fs from 'node:fs';
import path from 'node:path';
import { SQLITE_INTEGRATION_FOLDER } from './sqlite';

export function getSqliteDatabasePath( sitePath: string ): string {
	return path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
}

export function getSqliteIntegrationPath( sitePath: string ): string {
	return path.join( sitePath, 'wp-content', 'mu-plugins', SQLITE_INTEGRATION_FOLDER );
}

// Identifies a db.php copied from the plugin's db.copy (see the auto-generated header in that
// template). Stock drop-ins are refreshed on every update; custom, SQLite-compatible drop-ins are kept.
const STOCK_DB_DROPIN_MARKER = 'This file is auto-generated and copied from the sqlite plugin.';

// Since sqlite-database-integration 3.1, a database path that isn't configured moves
// wp-content/database/.ht.sqlite into a randomized directory on first load. Studio reads the
// database at the fixed path, so pin it unless the site configures its own location.
const DB_PATH_DEFINITION = `if ( ! defined( 'DB_PATH' ) && ! defined( 'FQDB' ) && ! defined( 'FQDBDIR' ) && ! defined( 'DB_DIR' ) && ! defined( 'DB_FILE' ) ) {
	define( 'DB_PATH', __DIR__ . '/database/.ht.sqlite' );
}
`;

/** Whether `pluginPath` holds a copy of the plugin that can be installed. */
export function isSqliteIntegrationAvailable( pluginPath: string ): boolean {
	return fs.existsSync( path.join( pluginPath, 'db.copy' ) );
}

export function isSqliteIntegrationInstalled( sitePath: string ): boolean {
	return (
		fs.existsSync( getSqliteIntegrationPath( sitePath ) ) &&
		fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) )
	);
}

/**
 * Whether the site runs on SQLite and needs the integration (re)installed.
 *
 * A site can run on its own database server, e.g. MySQL, once the SQLite drop-in, database and
 * plugin are removed and wp-config.php points at the server: the integration must not come back
 * over that. A SQLite site whose drop-in went missing still has its database or plugin, and needs
 * the drop-in restored. So: a fresh site (no wp-config.php) or any SQLite file left means yes.
 */
export function needsSqliteIntegration( sitePath: string ): boolean {
	return (
		! fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ||
		fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) ) ||
		fs.existsSync( getSqliteDatabasePath( sitePath ) ) ||
		fs.existsSync( getSqliteIntegrationPath( sitePath ) )
	);
}

/** Installs the integration from `pluginPath`, replacing any older copy of it. */
export async function installSqliteIntegration(
	sitePath: string,
	pluginPath: string
): Promise< void > {
	if ( ! isSqliteIntegrationAvailable( pluginPath ) ) {
		throw new Error( 'SQLite integration files not found.' );
	}

	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.dirname( getSqliteDatabasePath( sitePath ) );
	await fs.promises.mkdir( databasePath, { recursive: true } );

	if ( await shouldReplaceDbDropin( sitePath ) ) {
		const dbCopy = await fs.promises.readFile( path.join( pluginPath, 'db.copy' ), 'utf8' );
		const dropin = dbCopy
			.replace(
				"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
				`realpath( __DIR__ . '/mu-plugins/${ SQLITE_INTEGRATION_FOLDER }' )`
			)
			.replace( /^<\?php\s*\n/, ( openingTag ) => `${ openingTag }${ DB_PATH_DEFINITION }` );
		await fs.promises.writeFile( path.join( wpContentPath, 'db.php' ), dropin );
		// `wp sqlite import` and `export` run before db.php and would follow this file instead
		// of the pin. Playground exports include it.
		await fs.promises.rm( path.join( databasePath, 'db-path.php' ), { force: true } );
	}

	const integrationPath = getSqliteIntegrationPath( sitePath );
	await fs.promises.rm( integrationPath, { recursive: true, force: true } );
	await fs.promises.cp( pluginPath, integrationPath, { recursive: true, verbatimSymlinks: true } );
}

/** Installs or refreshes the integration of a site that runs on SQLite (see needsSqliteIntegration). */
export async function updateSqliteIntegration(
	sitePath: string,
	pluginPath: string
): Promise< void > {
	if ( needsSqliteIntegration( sitePath ) ) {
		await installSqliteIntegration( sitePath, pluginPath );
	}
}

/**
 * A db.php is kept only when it is a custom SQLite-compatible drop-in, which defines
 * SQLITE_DB_DROPIN_VERSION (how the plugin recognizes one): the site can only boot through a
 * drop-in the SQLite runtime understands. A missing one, the stock one, or a plugin's db.php
 * restored from a backup is replaced.
 */
async function shouldReplaceDbDropin( sitePath: string ): Promise< boolean > {
	let content: string;
	try {
		content = await fs.promises.readFile( path.join( sitePath, 'wp-content', 'db.php' ), 'utf8' );
	} catch {
		return true;
	}
	return (
		content.includes( STOCK_DB_DROPIN_MARKER ) || ! content.includes( 'SQLITE_DB_DROPIN_VERSION' )
	);
}
