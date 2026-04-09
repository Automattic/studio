import { SQLITE_FILENAME } from '@studio/common/constants';
import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';

class ElectronSqliteProvider extends SqliteIntegrationProvider {
	getServerFilesPath(): string {
		return getServerFilesPath();
	}

	getSqliteDirname(): string {
		return SQLITE_FILENAME;
	}
}

const provider = new ElectronSqliteProvider();

export const getSqliteVersionFromInstallation = ( sqliteMuPluginPath: string ) =>
	provider.getSqliteVersionFromInstallation( sqliteMuPluginPath );

export const keepSqliteIntegrationUpdated = ( sitePath: string ) =>
	provider.keepSqliteIntegrationUpdated( sitePath );
