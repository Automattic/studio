/**
 * Minimal SQLite command path module for vendor/wp-now to import
 * This avoids circular dependencies with the provider
 */
import os from 'os';
import path from 'path';
import fs from 'fs-extra';

/**
 * Get the path for SQLite command files
 * This is a simplified version that doesn't depend on other modules
 */
export function getSqliteCommandPath() {
	if ( process.env.NODE_ENV !== 'test' ) {
		// Use a simple path construction instead of importing getServerFilesPath
		const appPath =
			process.env.APPDATA ||
			( process.platform === 'darwin'
				? path.join( os.homedir(), 'Library', 'Application Support' )
				: path.join( os.homedir(), '.local', 'share' ) );
		return path.join( appPath, 'Studio', 'server-files', 'sqlite-command' );
	}

	const tmpPath = path.join( os.tmpdir(), `wp-now-tests-wp-sqlite-command-hidden-folder` );
	fs.ensureDirSync( tmpPath );
	return tmpPath;
}
