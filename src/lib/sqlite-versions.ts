import { SQLITE_FILENAME } from 'common/constants';
import { sequential } from 'common/lib/sequential';
import { SqliteIntegrationProvider } from 'common/lib/sqlite-integration';
import { getServerFilesPath } from 'src/storage/paths';

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

export const installSqliteIntegration = sequential( ( sitePath: string ) =>
	provider.installSqliteIntegration( sitePath )
);

export const keepSqliteIntegrationUpdated = ( sitePath: string ) =>
	provider.keepSqliteIntegrationUpdated( sitePath );
