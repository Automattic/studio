import os from 'os';
import path from 'path';

export function getConfigDirectory(): string {
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

export function getCliConfigPath(): string {
	if ( process.env.E2E && process.env.E2E_CLI_CONFIG_PATH ) {
		return path.join( process.env.E2E_CLI_CONFIG_PATH, 'cli.json' );
	}
	return path.join( getConfigDirectory(), 'cli.json' );
}

export function getCertificatesPath(): string {
	return path.join( getConfigDirectory(), 'certificates' );
}
