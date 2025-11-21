import path from 'path';
import fs from 'fs-extra';
import { sequential } from 'common/lib/sequential';
import { getWordPressProvider } from 'src/lib/wordpress-provider';
import { getServerFilesPath } from 'src/storage/paths';

export async function getSqliteVersionFromInstallation(
	sqliteMuPluginPath: string
): Promise< string > {
	let versionFileContent = '';
	try {
		versionFileContent = await fs.readFile( path.join( sqliteMuPluginPath, 'load.php' ), 'utf8' );
	} catch ( err ) {
		return '';
	}
	const matches = versionFileContent.match( /\s\*\sVersion:\s*([0-9a-zA-Z.-]+)/ );
	return matches?.[ 1 ] || '';
}

/**
 * If the site has a `/wp-content/db.php` file, or doesn't have a `/wp-config.php` file, we install
 * or update the SQLite integration plugin as needed.
 */
export async function keepSqliteIntegrationUpdated( sitePath: string ) {
	// Having a `/wp-content/db.php` file indicates that the user wants to use SQLite.
	const hasDbPhp = await fs.pathExists( path.join( sitePath, 'wp-content', 'db.php' ) );
	// Not having a `/wp-config.php` file indicates that the user wants to reset the config for their site.
	const hasWpConfig = await fs.pathExists( path.join( sitePath, 'wp-config.php' ) );

	if ( hasDbPhp || ! hasWpConfig ) {
		await installSqliteIntegration( sitePath );
	}
}

/**
 * Installs the SQLite integration in a site. This includes the must-used plugin
 * and the database file.
 */
export const installSqliteIntegration = sequential( async ( sitePath: string ): Promise< void > => {
	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.join( wpContentPath, 'database' );

	await fs.mkdir( databasePath, { recursive: true } );

	const dbPhpPath = path.join( wpContentPath, 'db.php' );
	const provider = getWordPressProvider();
	await fs.copyFile(
		path.join( getServerFilesPath(), provider.SQLITE_FILENAME, 'db.copy' ),
		dbPhpPath
	);
	const dbCopyContent = ( await fs.readFile( dbPhpPath, 'utf8' ) ).toString();
	await fs.writeFile(
		dbPhpPath,
		dbCopyContent.replace(
			"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			`realpath( __DIR__ . '/mu-plugins/${ provider.SQLITE_FILENAME }' )`
		)
	);
	const sqlitePluginPath = path.join( wpContentPath, 'mu-plugins', provider.SQLITE_FILENAME );
	await fs.copy( path.join( getServerFilesPath(), provider.SQLITE_FILENAME ), sqlitePluginPath );
} );
