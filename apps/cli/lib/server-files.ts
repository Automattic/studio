import os from 'os';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

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

// The only writable server-files path — WordPress is the one dependency that may be updated at
// runtime via `updateServerFiles`.
export function getWordPressVersionPath( version: string ): string {
	return path.join( getServerFilesPath(), 'wordpress-versions', version );
}

// Bundled `wp-files` paths. These are used for dependencies that ship read-only with the CLI
// and don't need a writable destination.

export function getBundledWpCliPharPath(): string {
	return path.join( getWpFilesPath(), 'wp-cli', 'wp-cli.phar' );
}

export function getBundledSqliteCommandPath(): string {
	return path.join( getWpFilesPath(), 'sqlite-command' );
}

export function getBundledSqlitePluginPath(): string {
	return path.join( getWpFilesPath(), 'sqlite-database-integration' );
}

export function getBundledLanguagePacksPath(): string {
	return path.join( getWpFilesPath(), 'latest', 'languages' );
}

export function getBundledSiteTranslationsPath(): string {
	return path.join( getWpFilesPath(), 'latest', 'available-site-translations.json' );
}

export function getBundledAiInstructionsPath(): string {
	return path.join( getWpFilesPath(), 'skills' );
}

export function getBundledPhpMyAdminPath(): string {
	return path.join( getWpFilesPath(), 'phpmyadmin' );
}
