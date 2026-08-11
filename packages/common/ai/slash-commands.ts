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
