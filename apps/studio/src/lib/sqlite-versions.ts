import { SQLITE_FILENAME } from '@studio/common/constants';
import { SqliteIntegrationProvider } from '@studio/common/lib/sqlite-integration';
import { getBundledSqlitePluginPath } from 'src/lib/server-files-paths';

class ElectronSqliteProvider extends SqliteIntegrationProvider {
	getSqliteDirname(): string {
		return SQLITE_FILENAME;
	}

	protected getSqlitePluginSourcePath(): string {
		return getBundledSqlitePluginPath();
	}
}

const provider = new ElectronSqliteProvider();

export const getSqliteVersionFromInstallation = ( sqliteMuPluginPath: string ) =>
	provider.getSqliteVersionFromInstallation( sqliteMuPluginPath );

export const keepSqliteIntegrationUpdated = ( sitePath: string ) =>
	provider.keepSqliteIntegrationUpdated( sitePath );

export const installSqliteIntegration = ( sitePath: string ) =>
	provider.installSqliteIntegration( sitePath );
