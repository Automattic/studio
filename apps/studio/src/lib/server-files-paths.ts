/**
 * Path utilities for server files.
 *
 * Two kinds of paths live here:
 * - Writable server-files under `~/.studio/server-files/` for deps that may be
 *   updated at runtime (WordPress).
 * - Read-only bundled `wp-files/` paths shipped alongside the CLI, for deps
 *   that don't need a writable destination (AI instructions, SQLite plugin).
 */

import os from 'os';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { getCliPath } from 'src/storage/paths';

const SQLITE_FILENAME = 'sqlite-database-integration';

function getTmpPath( subfolder: string ): string {
	return path.join( os.tmpdir(), `studio-tests-${ subfolder }` );
}

function getBasePath(): string {
	if ( process.env.NODE_ENV === 'test' ) {
		return getTmpPath( 'server-files' );
	}
	return getServerFilesPath();
}

function getBundledWpFilesPath(): string {
	return path.join( path.dirname( getCliPath() ), 'wp-files' );
}

function getWordPressVersionsPath(): string {
	return path.join( getBasePath(), 'wordpress-versions' );
}

export function getWordPressVersionPath( version: string ): string {
	return path.join( getWordPressVersionsPath(), version );
}

export function getSqlitePluginPath(): string {
	return path.join( getBasePath(), SQLITE_FILENAME );
}

export function getBundledAiInstructionsPath(): string {
	return path.join( getBundledWpFilesPath(), 'skills' );
}
