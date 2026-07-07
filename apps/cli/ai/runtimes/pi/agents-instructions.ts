import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getGlobalAgentsFilePath } from '@studio/common/lib/well-known-paths';

async function readInstructionFile( filePath: string ): Promise< string | undefined > {
	let content: string;
	try {
		content = await fs.promises.readFile( filePath, 'utf8' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return undefined;
		}
		console.warn( `[ai] Failed to read AGENTS.md at ${ filePath }:`, error );
		return undefined;
	}

	const trimmed = content.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Collect AGENTS.md instructions to append to the built-in agent's system
 * prompt, in precedence order: the user's global `~/.studio/AGENTS.md` first,
 * then the active local site's own `AGENTS.md`. pi concatenates
 * `appendSystemPrompt` entries in order, so the site block lands after the
 * global one and wins on conflict.
 *
 * Both files are optional and independent: a missing (ENOENT) or blank file is
 * skipped, and any other read error is logged and skipped, so behavior degrades
 * to "no extra instructions" rather than failing the turn. `activeSitePath`
 * should be the local site's root directory (omit it for remote sites, which
 * have no local AGENTS.md).
 */
export async function loadAgentsInstructions( activeSitePath?: string ): Promise< string[] > {
	const entries: string[] = [];

	const globalPath = getGlobalAgentsFilePath();
	const globalContent = await readInstructionFile( globalPath );
	if ( globalContent ) {
		entries.push(
			`<global_user_instructions path="${ globalPath }">
The following instructions come from the user's global AGENTS.md and apply to every site. A site's own AGENTS.md takes precedence over these on conflict.

${ globalContent }
</global_user_instructions>`
		);
	}

	if ( activeSitePath ) {
		const sitePath = path.join( activeSitePath, 'AGENTS.md' );
		const siteContent = await readInstructionFile( sitePath );
		if ( siteContent ) {
			entries.push(
				`<project_instructions path="${ sitePath }">
The following instructions come from this site's AGENTS.md and take precedence over the global instructions above.

${ siteContent }
</project_instructions>`
			);
		}
	}

	return entries;
}
