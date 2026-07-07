import { __ } from '@wordpress/i18n';

export interface SkillSlashCommand {
	name: string;
	description: string;
	/** Skill invoked by this command when it differs from `name` (alias commands). */
	skill?: string;
}

export const AI_SKILL_COMMANDS: SkillSlashCommand[] = [
	{ name: 'annotate', description: __( 'Annotate site elements visually in a browser' ) },
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
	{ name: 'rank-me-up', description: __( 'Run an on-page SEO audit on a site' ) },
	{
		name: 'liberate',
		description: __( 'Import & rebuild a site from a closed platform' ),
	},
	{
		name: 'migrate',
		skill: 'liberate',
		description: __( 'Import & rebuild a site from a closed platform (alias of /liberate)' ),
	},
];

export function buildSkillInvocationPrompt( name: string ): string {
	const skill = AI_SKILL_COMMANDS.find( ( cmd ) => cmd.name === name )?.skill ?? name;
	return `Run the /${ skill } skill using the Skill tool.`;
}
