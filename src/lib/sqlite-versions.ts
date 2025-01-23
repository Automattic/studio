import path from 'path';
import * as Sentry from '@sentry/electron/main';
import fs from 'fs-extra';
import semver from 'semver';
import { downloadSqliteIntegrationPlugin } from '../../vendor/wp-now/src/download';
import getSqlitePath from '../../vendor/wp-now/src/get-sqlite-path';

export async function isSqlLiteInstalled( installPath: string ) {
	const installedFiles = ( await fs.pathExists( installPath ) )
		? await fs.readdir( installPath )
		: [];
	return installedFiles.length !== 0;
}

/**
 * Updates the local SQLite integration located in server files to the latest version.
 */
export async function updateLatestSqliteVersion() {
	const installedPath = getSqlitePath();
	const shouldOverwrite = await isNewSqliteVersionAvailable();
	await downloadSqliteIntegrationPlugin( { overwrite: shouldOverwrite } );
	await removeLegacySqliteIntegrationPlugin( installedPath );
}

/**
 * Checks if there's a new version of the SQLite integration available.
 *
 * @returns True if there's a new version available.
 */
async function isNewSqliteVersionAvailable() {
	const installedVersion = semver.coerce(
		await getSqliteVersionFromInstallation( getSqlitePath() )
	);
	const latestVersion = semver.coerce( await getLatestSqliteVersion() );
	if ( ! installedVersion ) {
		return true;
	}
	if ( ! latestVersion ) {
		return false;
	}
	return semver.lt( installedVersion, latestVersion );
}

/**
 * Checks if the SQLite integration version installed in a site is outdated compared to the version
 * installed locally in the server files.
 *
 * @param sitePath Path of the site.
 *
 * @returns True if the SQLite integration is outdated.
 */
export async function isSqliteInstallationOutdated( sitePath: string ): Promise< boolean > {
	const serverFilesVersion = semver.coerce(
		await getSqliteVersionFromInstallation( getSqlitePath() )
	);
	const siteVersion = semver.coerce( await getSqliteVersionFromInstallation( sitePath ) );

	if ( ! siteVersion ) {
		return true;
	}

	if ( ! serverFilesVersion ) {
		return false;
	}

	return semver.lt( siteVersion, serverFilesVersion );
}

export async function getSqliteVersionFromInstallation(
	installationPath: string
): Promise< string > {
	let versionFileContent = '';
	try {
		versionFileContent = await fs.readFile( path.join( installationPath, 'load.php' ), 'utf8' );
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

/**
 * Removes legacy `sqlite-integration-plugin` installations from the specified
 * installation path that including a `-main` branch suffix.
 *
 * @param installPath The path where the plugin is installed.
 *
 * @returns A promise that resolves when the plugin is successfully removed.
 *
 * @todo Remove this function after a few releases.
 */
export async function removeLegacySqliteIntegrationPlugin( installPath: string ) {
	try {
		const legacySqlitePluginPath = `${ installPath }-main`;
		if ( await fs.pathExists( legacySqlitePluginPath ) ) {
			await fs.remove( legacySqlitePluginPath );
		}
	} catch ( error ) {
		// If the removal fails, log the error but don't throw
		Sentry.captureException( error );
	}
}
