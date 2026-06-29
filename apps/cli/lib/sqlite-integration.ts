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

export async function keepSqliteIntegrationUpdated( sitePath: string ) {
	return provider.keepSqliteIntegrationUpdated( sitePath );
}

export async function isSqliteIntegrationInstalled( sitePath: string ) {
	return provider.isSqliteInstalled( sitePath );
}

export async function getSqliteVersionFromInstallation( sqlitePath: string ) {
	return provider.getSqliteVersionFromInstallation( sqlitePath );
}
