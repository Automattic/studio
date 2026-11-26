import os from 'os';
import path from 'path';

export function getConfigDirectory(): string {
	if ( process.env.DEV_CONFIG_DIR ) {
		return process.env.DEV_CONFIG_DIR;
	}
	return path.join( os.homedir(), '.studio' );
}

export function getRemoteAccessConfigPath(): string {
	return path.join( getConfigDirectory(), 'remote.json' );
}

export function getSessionsDirectory(): string {
	if ( process.env.E2E && process.env.E2E_APP_DATA_PATH ) {
		return path.join( process.env.E2E_APP_DATA_PATH, 'Studio', 'sessions' );
	}
	return path.join( getConfigDirectory(), 'sessions' );
}

export function getKnowledgeDirectory(): string {
	return path.join( getConfigDirectory(), 'knowledge' );
}

export function getGlobalInstructionsPath(): string {
	return path.join( getKnowledgeDirectory(), 'instructions.md' );
}

// The user's skills for all sites: `<name>/SKILL.md` folders.
export function getGlobalSkillsDirectory(): string {
	return path.join( getConfigDirectory(), 'skills' );
}

// Where a global skill waits while it is switched off.
export function getDisabledGlobalSkillsDirectory(): string {
	return path.join( getConfigDirectory(), 'disabled-skills' );
}

// The skills other agents on this computer keep for every project.
export function getAgentsSkillsDirectory(): string {
	return path.join( os.homedir(), '.agents', 'skills' );
}

export function getCertificatesPath(): string {
	return path.join( getConfigDirectory(), 'certificates' );
}

export function getServerFilesPath(): string {
	return path.join( getConfigDirectory(), 'server-files' );
}

export function getMuPluginsPath(): string {
	return path.join( getConfigDirectory(), 'mu-plugins' );
}

export function getMuPluginSettingsPath(): string {
	return path.join( getMuPluginsPath(), 'settings.json' );
}

export function getAiPayloadsPath(): string {
	return path.join( getConfigDirectory(), 'tmp', 'ai-payloads' );
}
