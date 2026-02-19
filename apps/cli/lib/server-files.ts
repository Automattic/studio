import path from 'path';
import { getAppdataDirectory } from 'cli/lib/appdata';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_FOLDER = 'sqlite-command';

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
