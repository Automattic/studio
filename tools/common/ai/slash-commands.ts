import { __ } from '@wordpress/i18n';

export interface SkillSlashCommand {
	name: string;
	description: string;
}

export const AI_SKILL_COMMANDS: SkillSlashCommand[] = [
	{ name: 'annotate', description: __( 'Annotate site elements visually in a browser' ) },
	{ name: 'html-to-blocks', description: __( 'Transform HTML/CSS designs into editable blocks' ) },
	{
		name: 'blocks-to-theme',
		description: __( 'Turn an HTML-to-blocks workspace into a block theme' ),
	},
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
	{ name: 'rank-me-up', description: __( 'Run an on-page SEO audit on a site' ) },
];

export function buildSkillInvocationPrompt( name: string ): string {
	return `Run the /${ name } skill using the Skill tool.`;
}
