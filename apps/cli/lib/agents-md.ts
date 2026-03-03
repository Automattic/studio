import fs from 'fs';
import path from 'path';
import { AGENTS_MD_FILE_NAME, AGENTS_MD_TEMPLATE } from '@studio/common/lib/agents-md';

/**
 * Writes the default AGENTS.md file to the site root if one does not already exist.
 * The file guides AI coding agents toward Studio CLI commands, WordPress best practices,
 * and SQLite-specific conventions for sites managed by Studio.
 *
 * Skips writing if an AGENTS.md already exists so user-customised files are preserved.
 */
export async function writeAgentsMd( sitePath: string ): Promise< void > {
	const agentsMdPath = path.join( sitePath, AGENTS_MD_FILE_NAME );
	if ( fs.existsSync( agentsMdPath ) ) {
		return;
	}
	await fs.promises.writeFile( agentsMdPath, AGENTS_MD_TEMPLATE, 'utf-8' );
}
