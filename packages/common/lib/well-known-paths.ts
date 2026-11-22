import os from 'os';
import path from 'path';

export function getConfigDirectory(): string {
	if ( process.env.DEV_CONFIG_DIR ) {
		return process.env.DEV_CONFIG_DIR;
	}
	return path.join( os.homedir(), '.studio' );
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
