import { IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import { getOrCreateProcess, getProcess, stopProcess } from './studio-code-process';
import type { AiEngine, StudioCodeCommand } from './studio-code-types';

export async function studioCodeStart(
	_event: IpcMainInvokeEvent,
	siteId: string,
	sitePath: string,
	siteName: string,
	siteUrl: string
): Promise< void > {
	const proc = getOrCreateProcess( siteId, sitePath, siteName, siteUrl );
	await proc.start();
}

export async function studioCodeSend(
	_event: IpcMainInvokeEvent,
	siteId: string,
	command: StudioCodeCommand
): Promise< void > {
	const proc = getProcess( siteId );
	if ( proc ) {
		proc.send( command );
	}
}

export function studioCodeStop( _event: IpcMainInvokeEvent, siteId: string ): void {
	stopProcess( siteId );
}

export async function studioCodeCheckProvider(
	_event: IpcMainInvokeEvent
): Promise< { available: boolean; providers: string[] } > {
	const providers: string[] = [];
	const userData = await loadUserData();

	// Check for wpcom auth
	if ( userData.authToken ) {
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

export async function getAiEngine( _event: IpcMainInvokeEvent ): Promise< AiEngine > {
	const userData = await loadUserData();
	return userData.preferredAiEngine ?? 'studio-code';
}

export async function saveAiEngine(
	_event: IpcMainInvokeEvent,
	engine: AiEngine
): Promise< void > {
	await updateAppdata( { preferredAiEngine: engine } );
}
