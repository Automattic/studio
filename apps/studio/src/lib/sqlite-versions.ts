import { SQLITE_FILENAME } from '@studio/common/constants';
import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { getSqlitePluginPath } from 'src/lib/server-files-paths';

class ElectronSqliteProvider extends SqliteIntegrationProvider {
	getSqlitePluginSourcePath(): string {
		return getSqlitePluginPath();
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

export const installSqliteIntegration = ( sitePath: string ) =>
	provider.installSqliteIntegration( sitePath );
