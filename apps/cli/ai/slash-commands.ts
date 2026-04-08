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
	// Impeccable design skills
	{
		name: 'audit',
		description: __( 'Run technical quality checks (a11y, performance, responsive)' ),
	},
	{
		name: 'critique',
		description: __( 'UX design review: hierarchy, clarity, emotional resonance' ),
	},
	{ name: 'normalize', description: __( 'Align with design system standards' ) },
	{ name: 'polish', description: __( 'Final design pass before shipping' ) },
	{ name: 'distill', description: __( 'Strip design to its essence' ) },
	{ name: 'clarify', description: __( 'Improve unclear UX copy' ) },
	{ name: 'optimize', description: __( 'Performance improvements' ) },
	{ name: 'harden', description: __( 'Error handling, i18n, and edge cases' ) },
	{ name: 'animate', description: __( 'Add purposeful motion and animation' ) },
	{ name: 'colorize', description: __( 'Introduce strategic color' ) },
	{ name: 'bolder', description: __( 'Amplify boring designs' ) },
	{ name: 'quieter', description: __( 'Tone down overly bold designs' ) },
	{ name: 'delight', description: __( 'Add moments of joy' ) },
	{ name: 'extract', description: __( 'Pull into reusable components' ) },
	{ name: 'adapt', description: __( 'Adapt for different devices' ) },
	{ name: 'onboard', description: __( 'Design onboarding flows' ) },
	{ name: 'typeset', description: __( 'Fix font choices, hierarchy, sizing' ) },
	{ name: 'arrange', description: __( 'Fix layout, spacing, visual rhythm' ) },
	{ name: 'overdrive', description: __( 'Add technically extraordinary effects' ) },
	{ name: 'teach-impeccable', description: __( 'Set up design context for the project' ) },
];
