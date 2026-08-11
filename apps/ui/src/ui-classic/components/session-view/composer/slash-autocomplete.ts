import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import type { SkillSlashCommand } from '@studio/common/ai/slash-commands';

export interface SlashCommandMatches {
	open: boolean;
	matches: SkillSlashCommand[];
}

/**
 * Decides whether the slash-command popup is open and which commands match.
 * Opens when the draft ends with a `/` token at the start or after whitespace
 * (`path/to` doesn't trigger it); the text after the `/` is matched as a
 * case-insensitive substring of command names and descriptions.
 */
export function getSlashCommandMatches(
	value: string,
	previewPrompt: string | null | undefined
): SlashCommandMatches {
	if ( previewPrompt ) {
		return { open: false, matches: [] };
	}
	const match = /(?:^|\s)\/([\w-]*)$/.exec( value );
	if ( ! match ) {
		return { open: false, matches: [] };
	}
	const query = match[ 1 ].toLowerCase();
	const matches = getAiSkillCommands().filter(
		( command ) =>
			command.name.toLowerCase().includes( query ) ||
			command.description.toLowerCase().includes( query )
	);
	if ( matches.length === 0 ) {
		return { open: false, matches: [] };
	}
	return { open: true, matches };
}
