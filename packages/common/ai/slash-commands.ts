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

// Which predefined skill a prompt invokes, or `undefined` for an ordinary message. Handles both
// shapes that reach the agent: the bare `/rank-me-up`, and the sentence `buildSkillInvocationPrompt`
// expands it into (desktop expands before forking the CLI; `studio ui` does not). Only catalog names
// are returned — callers report this to analytics and must never echo arbitrary prompt text.
export function resolveSkillFromPrompt( prompt: string ): string | undefined {
	const trimmed = prompt.trim();
	const name = trimmed.startsWith( '/' )
		? trimmed.slice( 1 )
		: getAiSkillCommands().find( ( cmd ) => buildSkillInvocationPrompt( cmd.name ) === trimmed )
				?.name;
	return getAiSkillCommands().find( ( cmd ) => cmd.name === name )?.name;
}
