export interface SkillConfig {
	id: string;
	displayName: string;
	description: string;
}

export interface SkillStatus extends SkillConfig {
	installed: boolean;
}

export const BUNDLED_SKILLS: SkillConfig[] = [
	{
		id: 'wp-plugin-development',
		displayName: 'Plugin Development',
		description: 'Hooks, settings API, security, and packaging',
	},
	{
		id: 'wp-block-development',
		displayName: 'Block Development',
		description: 'Block.json, attributes, rendering, and deprecations',
	},
	{
		id: 'wp-block-themes',
		displayName: 'Block Themes',
		description: 'Theme.json, templates, patterns, and style variations',
	},
	{
		id: 'wp-rest-api',
		displayName: 'REST API',
		description: 'Routes, endpoints, schema, and authentication',
	},
	{
		id: 'wp-wpcli-and-ops',
		displayName: 'WP-CLI & Ops',
		description: 'CLI commands, automation, and search-replace',
	},
];
