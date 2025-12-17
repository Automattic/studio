/**
 * Path utilities for server files (WordPress versions, WP-CLI, SQLite)
 *
 * These replace the functions from vendor/wp-now to remove that dependency.
 * See STU-960: Remove PHP-WASM dependencies from Studio
 */

import os from 'os';
import path from 'path';
import { getServerFilesPath } from 'src/storage/paths';

// SQLite integration folder name
const SQLITE_FILENAME = 'sqlite-database-integration';

/**
 * Get a temporary path for tests
 */
function getTmpPath( subfolder: string ): string {
	return path.join( os.tmpdir(), `studio-tests-${ subfolder }` );
}

/**
 * Get the base path for server files (WordPress versions, SQLite, etc.)
 */
function getBasePath(): string {
	if ( process.env.NODE_ENV === 'test' ) {
		return getTmpPath( 'server-files' );
	}
	return getServerFilesPath();
}

/**
 * The path where WordPress zip files will be unzipped and stored.
 */
export function getWordPressVersionsPath(): string {
	return path.join( getBasePath(), 'wordpress-versions' );
}

/**
 * Get the path to a specific WordPress version folder.
 */
export function getWordPressVersionPath( version: string ): string {
	return path.join( getWordPressVersionsPath(), version );
}

/**
 * The full path to the "SQLite database integration" folder.
 */
export function getSqlitePath(): string {
	return path.join( getBasePath(), SQLITE_FILENAME );
}

/**
 * The path to the wp-cli folder.
 */
export function getWpCliFolderPath(): string {
	if ( process.env.NODE_ENV === 'test' ) {
		return getTmpPath( 'wp-cli' );
	}
	return getServerFilesPath();
}

/**
 * The path for wp-cli.phar file.
 */
export function getWpCliPath(): string {
	return path.join( getWpCliFolderPath(), 'wp-cli.phar' );
}
