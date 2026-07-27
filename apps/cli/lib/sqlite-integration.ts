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

export async function installSqliteIntegration( sitePath: string ) {
	return provider.installSqliteIntegration( sitePath );
}

export async function needsSqliteSetup( sitePath: string ) {
	return provider.needsSqliteSetup( sitePath );
}

export async function keepSqliteIntegrationUpdated( sitePath: string ) {
	return provider.keepSqliteIntegrationUpdated( sitePath );
}

export async function isSqliteIntegrationInstalled( sitePath: string ) {
	return provider.isSqliteInstalled( sitePath );
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

export async function getSqliteVersionFromInstallation( sqlitePath: string ) {
	return provider.getSqliteVersionFromInstallation( sqlitePath );
}
