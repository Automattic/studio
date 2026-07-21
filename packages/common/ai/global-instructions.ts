import fs from 'fs';
import path from 'path';
import { isErrnoException } from '../lib/is-errno-exception';
import { getGlobalInstructionsPath } from '../lib/well-known-paths';

/**
 * Read the user's global agent instructions (`~/.studio/knowledge/instructions.md`)
 * for injection into the system prompt. Returns `undefined` when the file is
 * missing, empty, or unreadable — the agent must keep working without
 * instructions.
 */
export async function readGlobalInstructions(): Promise< string | undefined > {
	let content: string;
	try {
		content = await fs.promises.readFile( getGlobalInstructionsPath(), 'utf8' );
	} catch ( error ) {
		if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
			console.error( '[global-instructions] Failed to read instructions file:', error );
		}
		return undefined;
	}
	return content.trim() || undefined;
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
