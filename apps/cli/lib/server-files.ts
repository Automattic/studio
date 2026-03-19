import os from 'os';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_FOLDER = 'sqlite-command';

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

export function getServerFilesPath(): string {
	return path.join( getAppdataDirectory(), 'server-files' );
}

export function getWpCliPharPath(): string {
	return path.join( getServerFilesPath(), WP_CLI_PHAR_FILENAME );
}

export function getSqliteCommandPath(): string {
	return path.join( getServerFilesPath(), SQLITE_COMMAND_FOLDER );
}

export function getLanguagePacksPath(): string {
	return path.join( getServerFilesPath(), 'language-packs' );
}

export function getAiInstructionsPath(): string {
	return path.join( getServerFilesPath(), 'skills' );
}
