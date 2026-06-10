/**
 * Path utilities for server files (WordPress versions, WP-CLI, SQLite)
 *
 */

import os from 'os';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { getCliExtractionDir, getCliPath } from 'src/storage/paths';

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
function getWordPressVersionsPath(): string {
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
 * The path to the bundled `wp-files/` directory that ships with the CLI.
 */
function getBundledWpFilesPath(): string {
	// In production the CLI's runtime assets (including wp-files) are extracted
	// from the standalone binary into the per-user CLI dir on first run. The
	// SEA entrypoint extracts before running any command, and app startup
	// awaits a first CLI command (`SiteServer.fetchAll()`) before creating the
	// main window — so extraction is complete before any consumer of this path
	// can run. In dev/test the assets sit next to the CLI script.
	if ( process.env.NODE_ENV === 'production' ) {
		return path.join( getCliExtractionDir(), 'wp-files' );
	}
	return path.join( path.dirname( getCliPath() ), 'wp-files' );
}

/**
 * The path where bundled AI instructions and skills live inside the CLI bundle.
 * These are installed into each site's `.agents/skills/` directory, so the source
 * is read-only and does not need a writable cache.
 */
export function getAiInstructionsPath(): string {
	return path.join( getBundledWpFilesPath(), 'skills' );
}

/**
 * The path to the bundled SQLite database integration plugin that ships with the
 * CLI. Installed into each site's `wp-content/mu-plugins/` directory.
 */
export function getBundledSqlitePluginPath(): string {
	return path.join( getBundledWpFilesPath(), SQLITE_FILENAME );
}
