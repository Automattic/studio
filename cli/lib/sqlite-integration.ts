/**
 * SQLite Integration for Studio CLI
 *
 * This module provides functions to set up SQLite integration for WordPress sites.
 * It uses the SQLite plugin files from the Studio Desktop app's server-files directory.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathExists } from 'common/lib/fs-utils';

const SQLITE_FILENAME = 'sqlite-database-integration';

/**
 * Get the path to Studio's server-files directory
 */
function getServerFilesPath(): string {
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio', 'server-files' );
}

/**
 * Get the path to the SQLite integration plugin in Studio's server-files
 */
function getSqlitePluginPath(): string {
	return path.join( getServerFilesPath(), SQLITE_FILENAME );
}

/**
 * Check if Studio's SQLite integration files are available
 */
export async function isSqliteIntegrationAvailable(): Promise< boolean > {
	const sqlitePath = getSqlitePluginPath();
	const dbCopyPath = path.join( sqlitePath, 'db.copy' );
	return ( await pathExists( sqlitePath ) ) && ( await pathExists( dbCopyPath ) );
}

/**
 * Check if a site needs SQLite integration setup
 * Returns true if the site has db.php (indicating SQLite usage) or no wp-config.php
 */
export async function needsSqliteSetup( sitePath: string ): Promise< boolean > {
	const hasDbPhp = await pathExists( path.join( sitePath, 'wp-content', 'db.php' ) );
	const hasWpConfig = await pathExists( path.join( sitePath, 'wp-config.php' ) );
	return hasDbPhp || ! hasWpConfig;
}

/**
 * Install SQLite integration in a WordPress site
 * This copies the necessary files from Studio's server-files to the site's wp-content directory
 */
export async function installSqliteIntegration( sitePath: string ): Promise< void > {
	const sqliteSourcePath = getSqlitePluginPath();

	if ( ! ( await pathExists( sqliteSourcePath ) ) ) {
		throw new Error(
			'SQLite integration files not found. Please ensure Studio Desktop is installed.'
		);
	}

	const wpContentPath = path.join( sitePath, 'wp-content' );
	const databasePath = path.join( wpContentPath, 'database' );

	// Create database directory
	fs.mkdirSync( databasePath, { recursive: true } );

	// Copy db.php and update the path
	const dbPhpPath = path.join( wpContentPath, 'db.php' );
	const dbCopySource = path.join( sqliteSourcePath, 'db.copy' );

	if ( ! ( await pathExists( dbCopySource ) ) ) {
		throw new Error( 'SQLite db.copy file not found in Studio server-files.' );
	}

	const dbCopyContent = fs.readFileSync( dbCopySource, 'utf8' );
	const updatedContent = dbCopyContent.replace(
		"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
		`realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
	);
	fs.writeFileSync( dbPhpPath, updatedContent );

	// Copy SQLite mu-plugin
	const muPluginsPath = path.join( wpContentPath, 'mu-plugins' );
	fs.mkdirSync( muPluginsPath, { recursive: true } );

	const sqliteDestPath = path.join( muPluginsPath, SQLITE_FILENAME );
	copyDirectoryRecursive( sqliteSourcePath, sqliteDestPath );
}

/**
 * Recursively copy a directory
 */
function copyDirectoryRecursive( source: string, destination: string ): void {
	if ( ! fs.existsSync( source ) ) {
		return;
	}

	fs.mkdirSync( destination, { recursive: true } );

	const entries = fs.readdirSync( source, { withFileTypes: true } );

	for ( const entry of entries ) {
		const sourcePath = path.join( source, entry.name );
		const destPath = path.join( destination, entry.name );

		if ( entry.isDirectory() ) {
			copyDirectoryRecursive( sourcePath, destPath );
		} else {
			fs.copyFileSync( sourcePath, destPath );
		}
	}
}

/**
 * Set up SQLite integration for a site if needed
 * This is the main entry point that checks conditions and installs SQLite
 */
export async function keepSqliteIntegrationUpdated( sitePath: string ): Promise< void > {
	if ( await needsSqliteSetup( sitePath ) ) {
		await installSqliteIntegration( sitePath );
	}
}
