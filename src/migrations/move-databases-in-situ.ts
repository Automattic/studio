import path from 'node:path';
import fs from 'fs-extra';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { getSqlitePath, SQLITE_FILENAME } from 'src/lib/wordpress-provider';
import { loadUserData } from 'src/storage/user-data';
import getWpNowConfig from 'vendor/wp-now/src/config';

async function moveDatabasesInSitu( projectPath: string ) {
	const dbPhpPath = path.join( projectPath, 'wp-content', 'db.php' );
	const hasDbPhpInSitu = fs.existsSync( dbPhpPath ) && fs.lstatSync( dbPhpPath ).isFile();

	const { wpContentPath } = await getWpNowConfig( { path: projectPath } );
	if (
		wpContentPath &&
		fs.existsSync( path.join( wpContentPath, 'database' ) ) &&
		! hasDbPhpInSitu
	) {
		// Do not mount but move the files to projectPath once
		const databasePath = path.join( projectPath, 'wp-content', 'database' );
		fs.rmdirSync( databasePath );
		fs.moveSync( path.join( wpContentPath, 'database' ), databasePath );

		const sqlitePath = path.join( projectPath, 'wp-content', 'plugins', SQLITE_FILENAME );
		fs.rmdirSync( sqlitePath );
		fs.copySync( path.join( getSqlitePath() ), sqlitePath );

		fs.rmdirSync( dbPhpPath );
		fs.copySync( path.join( getSqlitePath(), 'db.copy' ), dbPhpPath );
		fs.rmSync( wpContentPath, { recursive: true, force: true } );
	}
}

export async function migrateAllDatabasesInSitu() {
	const userData = await loadUserData();
	for ( const site of userData.sites ) {
		await moveDatabasesInSitu( site.path );
		await keepSqliteIntegrationUpdated( site.path );
	}
}
