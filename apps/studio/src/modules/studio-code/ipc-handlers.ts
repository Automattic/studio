import { IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { abortTurn, spawnTurn } from './studio-code-process';

export async function studioCodeSendMessage(
	_event: IpcMainInvokeEvent,
	siteId: string,
	sitePath: string,
	siteName: string,
	message: string
): Promise< void > {
	spawnTurn( siteId, sitePath, siteName, message );
}

export async function studioCodeRespondToPermission(
	_event: IpcMainInvokeEvent,
	siteId: string,
	sitePath: string,
	siteName: string,
	message: string,
	permissionResponse: Record< string, string >
): Promise< void > {
	spawnTurn( siteId, sitePath, siteName, message, { permissionResponse } );
}

export function studioCodeAbort( _event: IpcMainInvokeEvent, siteId: string ): void {
	abortTurn( siteId );
}

export async function studioCodeCheckProvider(
	_event: IpcMainInvokeEvent
): Promise< { available: boolean; providers: string[] } > {
	const providers: string[] = [];
	const sharedConfig = await readSharedConfig();

	// Check for wpcom auth
	if ( sharedConfig.authToken ) {
		providers.push( 'wpcom' );
	}

	// Check for ANTHROPIC_API_KEY env var
	if ( process.env.ANTHROPIC_API_KEY ) {
		providers.push( 'anthropic-api-key' );
	}

	// Check for Claude CLI auth
	const claudeConfigPath = path.join( os.homedir(), '.claude', '.credentials.json' );
	if ( fs.existsSync( claudeConfigPath ) ) {
		providers.push( 'anthropic-claude' );
	}

	return { available: providers.length > 0, providers };
}
