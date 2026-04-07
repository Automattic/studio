import { __ } from '@wordpress/i18n';

export interface SlashCommandDef {
	name: string;
	description: string;
}

export const AI_CHAT_BROWSER_COMMAND = '/browser';
export const AI_CHAT_API_KEY_COMMAND = '/api-key';
export const AI_CHAT_LOGIN_COMMAND = '/login';
export const AI_CHAT_LOGOUT_COMMAND = '/logout';
export const AI_CHAT_MODEL_COMMAND = '/model';
export const AI_CHAT_PROVIDER_COMMAND = '/provider';
export const AI_CHAT_PREVIEW_COMMAND = '/preview';
export const AI_CHAT_EXIT_COMMAND = '/exit';

export const AI_CHAT_SLASH_COMMANDS: SlashCommandDef[] = [
	{ name: 'browser', description: __( 'Open the active site in the browser' ) },
	{ name: 'api-key', description: __( 'Set or update the Anthropic API key' ) },
	{ name: 'login', description: __( 'Log in to WordPress.com' ) },
	{ name: 'logout', description: __( 'Log out of WordPress.com' ) },
	{ name: 'model', description: __( 'Switch the AI model' ) },
	{ name: 'provider', description: __( 'Switch the AI provider' ) },
	{ name: 'preview', description: __( 'Push the active site to WordPress.com as a preview' ) },
	{ name: 'exit', description: __( 'Exit the chat' ) },
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
	{
		name: 'design-setup',
		description: __( 'Discover design context for a site and write it to .impeccable.md' ),
	},
	{
		name: 'polish',
		description: __( 'Final quality pass: visual alignment, typography, interactions, edge cases' ),
	},
	{
		name: 'typeset',
		description: __( 'Improve typography: font hierarchy, sizing, readability, consistency' ),
	},
	{ name: 'animate', description: __( 'Add purposeful animations and micro-interactions' ) },
	{
		name: 'arrange',
		description: __( 'Fix spacing consistency, visual hierarchy, and layout rhythm' ),
	},
	{
		name: 'bolder',
		description: __( 'Amplify safe designs with more personality and visual impact' ),
	},
	{
		name: 'overdrive',
		description: __(
			'Push the design past conventional limits with technically ambitious implementations'
		),
	},
];
