import fs from 'fs';
import path from 'path';
import { isErrnoException } from '../lib/is-errno-exception';
import { readSharedConfig, updateSharedConfig } from '../lib/shared-config';
import { getGlobalInstructionsPath } from '../lib/well-known-paths';

/**
 * Read the user's global agent instructions (`~/.studio/knowledge/instructions.md`)
 * for injection into the system prompt. Returns `undefined` when the file is
 * missing, empty, or unreadable — the agent must keep working without
 * instructions.
 */
export async function readGlobalInstructions(): Promise< string | undefined > {
	const content = await readGlobalInstructionsFile().catch( ( error ) => {
		console.error( '[global-instructions] Failed to read instructions file:', error );
		return null;
	} );
	const trimmed = content?.trim();
	if ( ! trimmed || ! ( await readGlobalInstructionsEnabled( content ) ) ) {
		return undefined;
	}
	return trimmed;
}

/**
 * Read the raw file content for editing surfaces (settings UI). Returns `null`
 * when the file doesn't exist; other read errors propagate so the UI can
 * surface them.
 */
export async function readGlobalInstructionsFile(): Promise< string | null > {
	try {
		return await fs.promises.readFile( getGlobalInstructionsPath(), 'utf8' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}
}

export async function writeGlobalInstructions( content: string ): Promise< void > {
	const filePath = getGlobalInstructionsPath();
	await fs.promises.mkdir( path.dirname( filePath ), { recursive: true } );
	await fs.promises.writeFile( filePath, content, 'utf8' );
}

export async function readGlobalInstructionsEnabled( content?: string | null ): Promise< boolean > {
	const config = await readSharedConfig();
	if ( config.agentInstructionsEnabled !== undefined ) {
		return config.agentInstructionsEnabled;
	}
	const currentContent = content ?? ( await readGlobalInstructionsFile() );
	return Boolean( currentContent?.trim() );
}

export async function writeGlobalInstructionsEnabled( enabled: boolean ): Promise< void > {
	await updateSharedConfig( { agentInstructionsEnabled: enabled } );
}
