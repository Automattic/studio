import fs from 'fs';
import path from 'path';

export type DatabaseEngine = 'sqlite' | 'mysql';

export function getSiteDatabasePath( sitePath: string ): string {
	return path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
}

// With no site selected, describe Studio's default engine. For an existing site,
// preserve external database configurations only when every SQLite artifact is absent.
export function getSiteDatabaseEngine(
	sitePath?: string,
	sqliteDirname = 'sqlite-database-integration'
): DatabaseEngine {
	if ( sitePath === undefined ) {
		return 'sqlite';
	}
	const wpContentPath = path.join( sitePath, 'wp-content' );
	return ! fs.existsSync( path.join( sitePath, 'wp-config.php' ) ) ||
		fs.existsSync( path.join( wpContentPath, 'db.php' ) ) ||
		fs.existsSync( getSiteDatabasePath( sitePath ) ) ||
		fs.existsSync( path.join( wpContentPath, 'mu-plugins', sqliteDirname ) )
		? 'sqlite'
		: 'mysql';
}
