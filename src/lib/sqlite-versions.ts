import path from 'path';
import * as Sentry from '@sentry/electron/main';
import fs from 'fs-extra';
import semver from 'semver';
import { SQLITE_DATABASE_INTEGRATION_VERSION } from 'src/constants';
import { getSqlitePath, SQLITE_FILENAME, SQLITE_FILENAME_LEGACY } from 'src/lib/wordpress-provider';
import { getServerFilesPath } from 'src/storage/paths';

export async function isSqlLiteInstalled( installPath: string ) {
	// Check both standard and legacy (-main) paths
	const paths = [ installPath, installPath.replace( SQLITE_FILENAME, SQLITE_FILENAME_LEGACY ) ];

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
	const sqlitePath = path.join( sitePath, 'wp-content', 'mu-plugins', SQLITE_FILENAME );
	const hasWpConfig = await fs.pathExists( path.join( sitePath, 'wp-config.php' ) );
	const sqliteInstalled = await isSqlLiteInstalled( sqlitePath );
	const sqliteOutdated = sqliteInstalled && ( await isSqliteInstallationOutdated( sqlitePath ) );

	if ( ( ! sqliteInstalled && ! hasWpConfig ) || sqliteOutdated ) {
		await installSqliteIntegration( sitePath );
	}
}

/**
 * Installs the SQLite integration in a site. This includes the must-used plugin
 * and the database file.
 *
 * @param sitePath Path of the site.
 */
export async function installSqliteIntegration( sitePath: string ) {
	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.join( wpContentPath, 'database' );

	await fs.mkdir( databasePath, { recursive: true } );

	const dbPhpPath = path.join( wpContentPath, 'db.php' );
	await fs.copyFile( path.join( getServerFilesPath(), SQLITE_FILENAME, 'db.copy' ), dbPhpPath );
	const dbCopyContent = ( await fs.readFile( dbPhpPath, 'utf8' ) ).toString();
	await fs.writeFile(
		dbPhpPath,
		dbCopyContent.replace(
			"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			`realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		)
	);
	const sqlitePluginPath = path.join( wpContentPath, 'mu-plugins', SQLITE_FILENAME );
	await fs.copy( path.join( getServerFilesPath(), SQLITE_FILENAME ), sqlitePluginPath );

	await removeLegacySqliteIntegrationPlugin( sqlitePluginPath );
}
