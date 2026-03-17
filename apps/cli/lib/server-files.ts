import path from 'path';
import { STUDIO_CLI_HOME } from 'cli/lib/paths';

const WP_CLI_PHAR_FILENAME = 'wp-cli.phar';
const SQLITE_COMMAND_FOLDER = 'sqlite-command';

export function getServerFilesPath(): string {
	return path.join( STUDIO_CLI_HOME, 'server-files' );
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

export function getAgentSkillsPath(): string {
	return path.join( getServerFilesPath(), 'agent-skills' );
}
