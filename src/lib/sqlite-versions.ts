import path from 'path';
import fs from 'fs-extra';
import semver from 'semver';
import { SQLITE_DATABASE_INTEGRATION_VERSION } from 'common/constants';
import { setupSqliteDatabase, removeLegacySqliteIntegrationPlugin } from 'common/lib/sqlite-setup';
import { getSqlitePath, getWordPressProvider } from 'src/lib/wordpress-provider';
import { storagePaths } from 'src/storage/paths';

export async function isSqlLiteInstalled( installPath: string ) {
	// Check both standard and legacy (-main) paths
	const provider = getWordPressProvider();
	const paths = [
		installPath,
		installPath.replace( provider.SQLITE_FILENAME, provider.SQLITE_FILENAME_LEGACY ),
	];

	for ( const path of paths ) {
		const installedFiles = ( await fs.pathExists( path ) ) ? await fs.readdir( path ) : [];
		if ( installedFiles.length !== 0 ) {
			return true;
		}
	}
	return false;
}

/**
 * Updates the local SQLite integration located in server files to the latest version.
 */
export async function updateLatestSqliteVersion() {
	const installedPath = getSqlitePath();
	await removeLegacySqliteIntegrationPlugin( installedPath );
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
	const serverFilesVersion = semver.coerce( SQLITE_DATABASE_INTEGRATION_VERSION, {
		includePrerelease: true,
	} );
	const siteVersion = semver.coerce( await getSqliteVersionFromInstallation( sitePath ), {
		includePrerelease: true,
	} );

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

/**
 * Updates the SQLite integration in a site if it's outdated compared to the version
 * located in the server files.
 *
 * If the SQLite integration is not installed, it will be installed if the site
 * doesn't provide the configuration file `wp-config.php`.
 *
 * @param sitePath Path of the site.
 */
export async function keepSqliteIntegrationUpdated( sitePath: string ) {
	const sqlitePath = path.join(
		sitePath,
		'wp-content',
		'mu-plugins',
		getWordPressProvider().SQLITE_FILENAME
	);
	const hasWpConfig = await fs.pathExists( path.join( sitePath, 'wp-config.php' ) );
	const sqliteInstalled = await isSqlLiteInstalled( sqlitePath );
	const sqliteOutdated = sqliteInstalled && ( await isSqliteInstallationOutdated( sqlitePath ) );

	if ( ( ! sqliteInstalled && ! hasWpConfig ) || sqliteOutdated ) {
		await setupSqliteDatabase( sitePath, storagePaths.getServerFilesPath() );
	}
}
