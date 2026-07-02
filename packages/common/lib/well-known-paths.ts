import os from 'os';
import path from 'path';
import { APP_CONFIG_LOCKFILE_NAME, REMOTE_SESSION_STATE_LOCKFILE_NAME } from '../constants';

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

// WordPress.org has no OAuth; the desktop app captures the login session's
// cookies (see apps/studio/src/modules/user-settings/lib/wordpress-org-auth.ts)
// and snapshots them here so account status survives partition resets and can
// later be shared with the CLI.
export function getWordPressOrgStorageStatePath(): string {
	return path.join( getConfigDirectory(), 'wordpress-org-storage.json' );
}

export function getWordPressOrgStorageStateLockFilePath(): string {
	return path.join( getConfigDirectory(), '.wordpress-org-storage.lock' );
}
