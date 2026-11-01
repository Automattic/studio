import fs from 'fs';
import path from 'path';
import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { getWpFilesPath } from 'cli/lib/dependency-management/paths';

const SQLITE_FILENAME = 'sqlite-database-integration';

class CliSqliteProvider extends SqliteIntegrationProvider {
	getSqliteDirname(): string {
		return SQLITE_FILENAME;
	}

	protected getSqlitePluginSourcePath(): string {
		return path.join( getWpFilesPath(), SQLITE_FILENAME );
	}
}

const provider = new CliSqliteProvider();

export async function isSqliteIntegrationAvailable() {
	return provider.isSqliteIntegrationAvailable();
}

export async function keepSqliteIntegrationUpdated( sitePath: string ) {
	return provider.keepSqliteIntegrationUpdated( sitePath );
}

async function countPosts( sitePath: string, dbPath: string ): Promise< number > {
	try {
		const wpConfig = await fs.promises.readFile( path.join( sitePath, 'wp-config.php' ), 'utf8' );
		const prefix = /\$table_prefix\s*=\s*['"](\w+)['"]/.exec( wpConfig )?.[ 1 ] ?? 'wp_';
		const { DatabaseSync } = await import( 'node:sqlite' );
		const database = new DatabaseSync( dbPath, { readOnly: true } );
		try {
			const row = database.prepare( `SELECT COUNT(*) AS total FROM ${ prefix }posts` ).get();
			return ( row as { total: number } ).total;
		} finally {
			database.close();
		}
	} catch {
		return -1;
	}
}

/**
 * Removes a db-path.php from a pinned site, so `wp sqlite import` and `export`, which run before
 * db.php defines DB_PATH, use the same database as WordPress. If the database it records has at
 * least as many posts it takes the fixed path, leaving the other at .ht.sqlite.replaced.
 *
 * The site must be stopped.
 */
export async function restoreFixedDatabasePath( sitePath: string ): Promise< void > {
	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.join( wpContentPath, 'database' );
	const pathFile = path.join( databasePath, 'db-path.php' );
	if ( ! fs.existsSync( pathFile ) ) {
		return;
	}

	const dropin = await fs.promises
		.readFile( path.join( wpContentPath, 'db.php' ), 'utf8' )
		.catch( () => '' );
	const recordedFile = /'\/(\.ht\.[0-9a-f]+\/\.ht\.sqlite)'/.exec(
		await fs.promises.readFile( pathFile, 'utf8' )
	)?.[ 1 ];
	if ( ! dropin.includes( "define( 'DB_PATH'" ) || ! recordedFile ) {
		return;
	}

	const fixedPath = path.join( databasePath, '.ht.sqlite' );
	const recordedPath = path.join( databasePath, recordedFile );
	if (
		fs.existsSync( recordedPath ) &&
		( await countPosts( sitePath, recordedPath ) ) >= ( await countPosts( sitePath, fixedPath ) )
	) {
		for ( const suffix of [ '', '-wal', '-shm' ] ) {
			if ( fs.existsSync( fixedPath + suffix ) ) {
				await fs.promises.rename( fixedPath + suffix, `${ fixedPath }.replaced${ suffix }` );
			}
			if ( fs.existsSync( recordedPath + suffix ) ) {
				await fs.promises.rename( recordedPath + suffix, fixedPath + suffix );
			}
		}
	}
	await fs.promises.rm( pathFile );
}

/**
 * Installs the SQLite integration for imported (reprint-pulled) sites when it's
 * missing. Those sites wire SQLite through runtime.php and ship no db.php drop-in,
 * so keepSqliteIntegrationUpdated skips them — but tools that need the integration
 * discoverable in wp-content (e.g. `wp sqlite export`) can call this first.
 * No-op for regular sites.
 */
export async function ensureSqliteIntegrationForImportedSite( site: {
	path: string;
	runtimeBlueprintPath?: string;
} ) {
	if ( site.runtimeBlueprintPath && ! ( await provider.isSqliteInstalled( site.path ) ) ) {
		await provider.installSqliteIntegration( site.path );
	}
}
