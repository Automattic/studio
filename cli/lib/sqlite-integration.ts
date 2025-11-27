import os from 'os';
import path from 'path';
import { SqliteIntegrationProvider } from 'common/lib/sqlite-integration';

const SQLITE_FILENAME = 'sqlite-database-integration';

class CliSqliteProvider extends SqliteIntegrationProvider {
	getServerFilesPath(): string {
		return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'server-files' );
	}

	getSqliteFilename(): string {
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
