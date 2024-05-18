import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { downloadSqliteIntegrationPlugin } from '../../vendor/wp-now/src/download';
import getSqlitePath from '../../vendor/wp-now/src/get-sqlite-path';

export async function updateLatestSqliteVersion() {
	let shouldOverwrite = false;
	const installedPath = getSqlitePath();
	const installedFiles = ( await fs.pathExists( installedPath ) )
		? await fs.readdir( installedPath )
		: [];
	if ( installedFiles.length !== 0 ) {
		shouldOverwrite = await isSqliteInstallationOutdated( installedPath );
	}

	await downloadSqliteIntegrationPlugin( { overwrite: shouldOverwrite } );
}

export async function isSqliteInstallationOutdated( installationPath: string ): Promise< boolean > {
	try {
		const installedVersion = getSqliteVersionFromInstallation( installationPath );
		const latestVersion = await getLatestSqliteVersion();
		return latestVersion ? semver.lt( installedVersion, latestVersion ) : false;
	} catch ( _error ) {
		return false;
	}
}

function getSqliteVersionFromInstallation( installationPath: string ): string {
	let versionFileContent = '';
	try {
		versionFileContent = fs.readFileSync( path.join( installationPath, 'load.php' ), 'utf8' );
	} catch ( err ) {
		return '';
	}
	const matches = versionFileContent.match( /\s\*\sVersion:\s*([0-9a-zA-Z.-]+)/ );
	return matches?.[ 1 ] || '';
}

let latestSqliteVersionsCache: string | null = null;

async function getLatestSqliteVersion() {
	// Only fetch the latest version once per app session
	if ( latestSqliteVersionsCache ) {
		return latestSqliteVersionsCache;
	}

	try {
		const response = await fetch(
			'https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&slug=sqlite-database-integration'
		);
		const data: Record< string, string > = await response.json();
		latestSqliteVersionsCache = data.version;
	} catch ( _error ) {
		// Discard the failed fetch, return the cache
	}

	return latestSqliteVersionsCache;
}
