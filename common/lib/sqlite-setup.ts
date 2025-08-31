import path from 'path';
import fs from 'fs-extra';
import { SQLITE_FILENAME } from '../constants';

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
		console.error( 'Failed to remove legacy SQLite integration plugin:', error );
	}
}

/**
 * Sets up the SQLite database integration in a WordPress site. This includes the
 * must-use plugin and the database configuration file.
 *
 * @param sitePath Path of the site.
 * @param serverFilesPath Path to server files containing SQLite integration.
 */
export async function setupSqliteDatabase( sitePath: string, serverFilesPath: string ) {
	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.join( wpContentPath, 'database' );

	await fs.mkdir( databasePath, { recursive: true } );

	const dbPhpPath = path.join( wpContentPath, 'db.php' );
	await fs.copyFile( path.join( serverFilesPath, SQLITE_FILENAME, 'db.copy' ), dbPhpPath );
	const dbCopyContent = ( await fs.readFile( dbPhpPath, 'utf8' ) ).toString();
	await fs.writeFile(
		dbPhpPath,
		dbCopyContent.replace(
			"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			`realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		)
	);
	const sqlitePluginPath = path.join( wpContentPath, 'mu-plugins', SQLITE_FILENAME );
	await fs.copy( path.join( serverFilesPath, SQLITE_FILENAME ), sqlitePluginPath );

	await removeLegacySqliteIntegrationPlugin( sqlitePluginPath );
}
