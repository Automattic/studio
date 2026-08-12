import { __ } from '@wordpress/i18n';

export interface SkillSlashCommand {
	name: string;
	description: string;
}

export const getAiSkillCommands = (): SkillSlashCommand[] => [
	{ name: 'annotate', description: __( 'Annotate site elements visually in a browser' ) },
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
	{ name: 'rank-me-up', description: __( 'Run an on-page SEO audit on a site' ) },
	{
		name: 'liberate',
		description: __( 'Migrate & rebuild a site from a closed platform' ),
	},
];

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

export function buildSkillInvocationPrompt( name: string ): string {
	return `Run the /${ name } skill using the Skill tool.`;
}

// Expand a bare skill prompt (e.g. `/rank-me-up`) into the instruction the
// agent acts on, matching the CLI's interactive main loop.
export function expandSkillCommandPrompt( prompt: string ): string {
	const trimmed = prompt.trim();
	if ( ! trimmed.startsWith( '/' ) ) {
		return prompt;
	}
	const name = trimmed.slice( 1 );
	const match = getAiSkillCommands().find( ( cmd ) => cmd.name === name );
	if ( ! match ) {
		return prompt;
	}
	return buildSkillInvocationPrompt( name );
}
