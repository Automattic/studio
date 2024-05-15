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
	const latestVersion = await getLatestSqliteVersion();
	if ( installedFiles.length !== 0 ) {
		const installedVersion = getSqliteVersionFromInstallation( installedPath );
		shouldOverwrite = !! installedVersion && !! latestVersion && installedVersion !== latestVersion;
	}

	await downloadSqliteIntegrationPlugin( latestVersion, { overwrite: shouldOverwrite } );
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

async function getLatestSqliteVersion() {
	const sqliteVersions = await fetchSqliteVersions();
	return sqliteVersions.latest;
}

async function fetchSqliteVersions() {
	try {
		const response = await fetch(
			'https://api.github.com/repos/WordPress/sqlite-database-integration/releases'
		);
		const data: Record< string, string >[] = await response.json();
		const versions = data.map( ( release ) => semver.coerce( release.tag_name ) );
		return {
			versions,
			latest: versions[ 0 ]?.version || '',
		};
	} catch ( _error ) {
		return { versions: [], latest: '' };
	}
}
