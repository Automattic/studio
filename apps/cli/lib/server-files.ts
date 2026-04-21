import os from 'os';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_DIRNAME = 'sqlite-command';

export function getAppdataDirectory(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio' );
	}

	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new LoggerError( __( 'Studio config file path not found.' ) );
		}

		return path.join( process.env.APPDATA, 'Studio' );
	}

	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

// The `wp-files` directory is located in the same directory as the CLI code. It ships with the
// installer and contains the unaltered dependencies.
export function getWpFilesPath(): string {
	return path.join( import.meta.dirname, 'wp-files' );
}

export function getWordPressVersionPath( version: string ): string {
	return path.join( getServerFilesPath(), 'wordpress-versions', version );
}

// WP-CLI ships read-only with the CLI bundle and is mounted into the PHP-wasm VFS at
// `/tmp/wp-cli.phar`. No writable cache needed.
export function getWpCliPharPath(): string {
	return path.join( getWpFilesPath(), 'wp-cli', WP_CLI_PHAR_FILENAME );
}

// SQLite command ships read-only with the CLI bundle and is mounted into the PHP-wasm
// VFS at `/tmp/sqlite-command`. No writable cache needed.
export function getSqliteCommandPath(): string {
	return path.join( getWpFilesPath(), SQLITE_COMMAND_DIRNAME );
}

export function getLanguagePacksPath(): string {
	return path.join( getServerFilesPath(), 'language-packs' );
}

// AI instructions ship read-only with the CLI bundle and are installed into each site's
// `.agents/skills/` directory on site create/start. No writable cache needed — the bundled
// directory is treated as the source of truth.
export function getAiInstructionsPath(): string {
	return path.join( getWpFilesPath(), 'skills' );
}

export function getPhpMyAdminPath(): string {
	return path.join( getServerFilesPath(), 'phpmyadmin' );
}
