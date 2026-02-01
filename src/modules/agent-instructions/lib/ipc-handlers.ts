/**
 * IPC handlers for Agent Instructions.
 *
 * These handlers install and report status for instruction files (CLAUDE.md, AGENTS.md) per site.
 */

import type { IpcMainInvokeEvent } from 'electron';
import { loadUserData } from 'src/storage/user-data';
import {
	getAllInstructionFilesStatus,
	getInstructionFileStatus,
	installInstructionFile,
	installAllInstructionFiles,
	type InstructionFileStatus,
} from './instructions';
import { DEFAULT_AGENT_INSTRUCTIONS, type InstructionFileType } from '../constants';

async function getSitePath( siteId: string ): Promise< string > {
	const userData = await loadUserData();
	const site = userData.sites.find( ( s ) => s.id === siteId );

	if ( ! site ) {
		throw new Error( `Site not found: ${ siteId }` );
	}

	return site.path;
}

/**
 * Get status of all instruction files for a site.
 */
export async function getAgentInstructionsStatus(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< InstructionFileStatus[] > {
	const sitePath = await getSitePath( siteId );
	return getAllInstructionFilesStatus( sitePath );
}

/**
 * Get status of a specific instruction file.
 */
export async function getInstructionFileStatusHandler(
	_event: IpcMainInvokeEvent,
	siteId: string,
	fileType: InstructionFileType
): Promise< InstructionFileStatus > {
	const sitePath = await getSitePath( siteId );
	return getInstructionFileStatus( sitePath, fileType );
}

/**
 * Install a specific instruction file.
 */
export async function installAgentInstructions(
	_event: IpcMainInvokeEvent,
	siteId: string,
	options?: { overwrite?: boolean; fileType?: InstructionFileType }
): Promise< { path: string; overwritten: boolean } > {
	const sitePath = await getSitePath( siteId );
	const overwrite = options?.overwrite ?? false;
	const fileType = options?.fileType ?? 'agents';
	return installInstructionFile( sitePath, fileType, DEFAULT_AGENT_INSTRUCTIONS, overwrite );
}

/**
 * Install all instruction files (CLAUDE.md and AGENTS.md).
 */
export async function installAllAgentInstructions(
	_event: IpcMainInvokeEvent,
	siteId: string,
	options?: { overwrite?: boolean }
): Promise< Array< { fileType: InstructionFileType; path: string; overwritten: boolean } > > {
	const sitePath = await getSitePath( siteId );
	const overwrite = options?.overwrite ?? false;
	return installAllInstructionFiles( sitePath, DEFAULT_AGENT_INSTRUCTIONS, overwrite );
}
