import { __ } from '@wordpress/i18n';

export interface SkillConfig {
	id: string;
	displayName: string;
	description: string;
}

export interface SkillStatus extends SkillConfig {
	installed: boolean;
}

export const getBundledSkills = (): SkillConfig[] => [
	{
		id: 'studio-cli',
		displayName: __( 'Studio CLI' ),
		description: __( 'WordPress development workflows using Studio CLI' ),
	},
	{
		id: 'wp-plugin-development',
		displayName: __( 'Plugin Development' ),
		description: __( 'Hooks, settings API, security, and packaging' ),
	},
	{
		id: 'wp-block-development',
		displayName: __( 'Block Development' ),
		description: __( 'Block.json, attributes, rendering, and deprecations' ),
	},
	{
		id: 'wp-block-themes',
		displayName: __( 'Block Themes' ),
		description: __( 'Theme.json, templates, patterns, and style variations' ),
	},
	{
		id: 'wp-rest-api',
		displayName: __( 'REST API' ),
		description: __( 'Routes, endpoints, schema, and authentication' ),
	},
	{
		id: 'wp-wpcli-and-ops',
		displayName: __( 'WP-CLI & Ops' ),
		description: __( 'CLI commands, automation, and search-replace' ),
	},
];
