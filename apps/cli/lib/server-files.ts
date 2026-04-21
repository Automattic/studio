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

// Writable server-files paths — copied from the bundled `wp-files/` on CLI startup so they can
// be mounted into PHP-wasm. Using user-writable copies avoids permission/access issues when
// mounting files from the macOS app bundle.
export function getWordPressVersionPath( version: string ): string {
	return path.join( getServerFilesPath(), 'wordpress-versions', version );
}

export function getWpCliPharPath(): string {
	return path.join( getServerFilesPath(), 'wp-cli.phar' );
}

export function getSqliteCommandPath(): string {
	return path.join( getServerFilesPath(), 'sqlite-command' );
}

export function getPhpMyAdminPath(): string {
	return path.join( getServerFilesPath(), 'phpmyadmin' );
}

export function getSqlitePluginPath(): string {
	return path.join( getServerFilesPath(), 'sqlite-database-integration' );
}

// Bundled `wp-files` paths. These are used for dependencies that ship read-only with the CLI
// and don't need a writable destination.

export function getBundledLanguagePacksPath(): string {
	return path.join( getWpFilesPath(), 'latest', 'languages' );
}

export function getBundledSiteTranslationsPath(): string {
	return path.join( getWpFilesPath(), 'latest', 'available-site-translations.json' );
}

export function getBundledAiInstructionsPath(): string {
	return path.join( getWpFilesPath(), 'skills' );
}
