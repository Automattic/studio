import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { getSqlitePluginPath } from 'cli/lib/server-files';

const SQLITE_FILENAME = 'sqlite-database-integration';

class CliSqliteProvider extends SqliteIntegrationProvider {
	getSqlitePluginSourcePath(): string {
		return getSqlitePluginPath();
	}

	getSqliteDirname(): string {
		return SQLITE_FILENAME;
	}
}

const provider = new CliSqliteProvider();

export async function isSqliteIntegrationAvailable() {
	return provider.isSqliteIntegrationAvailable();
}

export async function needsSqliteSetup( sitePath: string ) {
	return provider.needsSqliteSetup( sitePath );
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
