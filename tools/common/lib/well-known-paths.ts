import os from 'os';
import path from 'path';
import {
	APP_CONFIG_LOCKFILE_NAME,
	PUBLISHING_CONFIG_LOCKFILE_NAME,
	REMOTE_SESSION_STATE_LOCKFILE_NAME,
	WORDPRESS_ORG_STORAGE_STATE_LOCKFILE_NAME,
} from '../constants';

export function getConfigDirectory(): string {
	if ( process.env.DEV_CONFIG_DIR ) {
		return process.env.DEV_CONFIG_DIR;
	}
	if ( process.env.E2E && process.env.E2E_SHARED_CONFIG_PATH ) {
		return process.env.E2E_SHARED_CONFIG_PATH;
	}
	return path.join( os.homedir(), '.studio' );
}

export function getSharedConfigPath(): string {
	return path.join( getConfigDirectory(), 'shared.json' );
}

export function getAppConfigPath(): string {
	return path.join( getConfigDirectory(), 'app.json' );
}

export function getAppConfigLockFilePath(): string {
	return path.join( getConfigDirectory(), APP_CONFIG_LOCKFILE_NAME );
}

export function getCliConfigPath(): string {
	if ( process.env.E2E && process.env.E2E_CLI_CONFIG_PATH ) {
		return path.join( process.env.E2E_CLI_CONFIG_PATH, 'cli.json' );
	}
	return path.join( getConfigDirectory(), 'cli.json' );
}

export function getPublishingConfigPath(): string {
	return path.join( getConfigDirectory(), 'publishing.json' );
}

export function getPublishingConfigLockFilePath(): string {
	return path.join( getConfigDirectory(), PUBLISHING_CONFIG_LOCKFILE_NAME );
}

export function getDevelopmentProjectsDirectory(): string {
	return path.join( os.homedir(), 'Studio', 'Plugins' );
}

export function getDevelopmentPlaygroundSitesDirectory(): string {
	return path.join( os.homedir(), 'Studio', 'Plugin Playgrounds' );
}

export function getWordPressOrgStorageStatePath(): string {
	return path.join( getConfigDirectory(), 'wordpress-org-storage.json' );
}

export function getWordPressOrgStorageStateLockFilePath(): string {
	return path.join( getConfigDirectory(), WORDPRESS_ORG_STORAGE_STATE_LOCKFILE_NAME );
}

export function getCertificatesPath(): string {
	return path.join( getConfigDirectory(), 'certificates' );
}

export function getServerFilesPath(): string {
	return path.join( getConfigDirectory(), 'server-files' );
}

export function getAiPayloadsPath(): string {
	return path.join( getConfigDirectory(), 'tmp', 'ai-payloads' );
}

export function getRemoteSessionConfigPath(): string {
	return path.join( getConfigDirectory(), 'remote-session.json' );
}

export function getRemoteSessionStatePath(): string {
	return path.join( getConfigDirectory(), 'remote-session-state.json' );
}

export function getRemoteSessionStateLockFilePath(): string {
	return path.join( getConfigDirectory(), REMOTE_SESSION_STATE_LOCKFILE_NAME );
}

export function getRemoteSessionLogPath(): string {
	return path.join( getConfigDirectory(), 'remote-session.log' );
}

export function getRemoteSessionPidPath(): string {
	return path.join( getConfigDirectory(), 'remote-session.pid' );
}
