import os from 'os';
import path from 'path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_DIRNAME = 'sqlite-command';
const SQLITE_PLUGIN_DIRNAME = 'sqlite-database-integration';

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

export function getWpCliPharPath(): string {
	return path.join( getServerFilesPath(), WP_CLI_PHAR_FILENAME );
}

export function getSqlitePluginPath(): string {
	return path.join( getServerFilesPath(), SQLITE_PLUGIN_DIRNAME );
}

export function getSqliteCommandPath(): string {
	return path.join( getServerFilesPath(), SQLITE_COMMAND_DIRNAME );
}

export function getLanguagePacksPath(): string {
	return path.join( getServerFilesPath(), 'language-packs' );
}

export function getAiInstructionsPath(): string {
	return path.join( getServerFilesPath(), 'skills' );
}
