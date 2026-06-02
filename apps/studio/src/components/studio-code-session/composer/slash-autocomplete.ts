import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import type { SkillSlashCommand } from '@studio/common/ai/slash-commands';

export interface SlashCommandMatches {
	open: boolean;
	matches: SkillSlashCommand[];
}

/**
 * Pure helper that decides whether the inline slash-command autocomplete popup
 * should be open and, if so, which commands match the current draft.
 *
 * The popup opens when the textarea ends with a `/` token that sits at the
 * very start or right after whitespace (e.g. `/`, `/an`, `fix this /sp`), and
 * no preview prompt is active. A `/` glued to the end of a word (e.g.
 * `path/to`) does not trigger it. The text after the `/` is matched as a
 * case-insensitive substring against the available skill command names (so
 * `/speed` matches `need-for-speed`). If nothing matches, the popup closes.
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
	const matches = AI_SKILL_COMMANDS.filter( ( command ) =>
		command.name.toLowerCase().includes( query )
	);
	if ( matches.length === 0 ) {
		return { open: false, matches: [] };
	}
	return { open: true, matches };
}
