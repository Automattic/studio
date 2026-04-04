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
export const AI_CHAT_EXIT_COMMAND = '/exit';

export const AI_CHAT_SLASH_COMMANDS: SlashCommandDef[] = [
	{ name: 'browser', description: __( 'Open the active site in the browser' ) },
	{ name: 'api-key', description: __( 'Set or update the Anthropic API key' ) },
	{ name: 'login', description: __( 'Log in to WordPress.com' ) },
	{ name: 'logout', description: __( 'Log out of WordPress.com' ) },
	{ name: 'model', description: __( 'Switch the AI model' ) },
	{ name: 'provider', description: __( 'Switch the AI provider' ) },
	{ name: 'exit', description: __( 'Exit the chat' ) },
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
];
