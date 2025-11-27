import { sequential } from 'common/lib/sequential';
import { SqliteIntegrationProvider } from 'common/lib/sqlite-integration';
import { getWordPressProvider } from 'src/lib/wordpress-provider';
import { getServerFilesPath } from 'src/storage/paths';

class ElectronSqliteProvider extends SqliteIntegrationProvider {
	getServerFilesPath(): string {
		return getServerFilesPath();
	}

	getSqliteFilename(): string {
		return getWordPressProvider().SQLITE_FILENAME;
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

export { provider };
