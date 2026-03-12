import childProcess from 'child_process';
import { password } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { getAnthropicApiKey, getAuthToken, saveAnthropicApiKey } from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-claude': 'Anthropic · Claude auth',
	'anthropic-api-key': 'Anthropic · API key',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export const aiProviderSchema = z.enum( [ 'wpcom', 'anthropic-claude', 'anthropic-api-key' ] );
export const DEFAULT_AI_PROVIDER: AiProviderId = 'anthropic-api-key';
export const AI_PROVIDER_PRIORITY: AiProviderId[] = [
	'wpcom',
	'anthropic-claude',
	'anthropic-api-key',
];

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const WPCOM_AI_FEATURE_HEADER = 'studio-assistant-anthropic';

export interface AiProviderDefinition {
	id: AiProviderId;
	autoFallbackWhenUnavailable: boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: () => Promise< void >;
	resolveEnv: () => Promise< Record< string, string > >;
}

export function hasClaudeCodeAuth(): boolean {
	try {
		const output = childProcess.execFileSync( 'claude', [ 'auth', 'status' ], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		} );
		return (
			output.toLowerCase().includes( 'authenticated' ) || ! output.toLowerCase().includes( 'not' )
		);
	} catch {
		return false;
	}
}

async function resolveAnthropicApiKey(): Promise< string | undefined > {
	const savedKey = await getAnthropicApiKey();
	if ( savedKey ) {
		return savedKey;
	}

	const apiKey = await password( {
		message: __( 'Enter your Anthropic API key (will be saved for future use):' ),
		mask: '*',
		validate: ( value ) => {
			if ( ! value.trim() ) {
				return __( 'API key is required' );
			}
			return true;
		},
	} );

	await saveAnthropicApiKey( apiKey );
	return apiKey;
}

function buildAnthropicCustomHeaders( headers: Record< string, string > ): string {
	return Object.entries( headers )
		.map( ( [ name, value ] ) => `${ name }: ${ value }` )
		.join( '\n' );
}

function getWpcomAiGatewayBaseUrl(): string {
	const customBaseUrl = process.env.WPCOM_AI_PROXY_BASE_URL?.trim();
	return customBaseUrl || DEFAULT_WPCOM_AI_GATEWAY_BASE_URL;
}

async function hasValidWpcomAuth(): Promise< boolean > {
	try {
		await getAuthToken();
		return true;
	} catch {
		return false;
	}
}

function createBaseEnvironment(): Record< string, string > {
	const env = { ...( process.env as Record< string, string > ) };

	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_CUSTOM_HEADERS;
	delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;

	return env;
}

const AI_PROVIDER_DEFINITIONS: Record< AiProviderId, AiProviderDefinition > = {
	wpcom: {
		id: 'wpcom',
		autoFallbackWhenUnavailable: true,
		isVisible: async () => true,
		isReady: hasValidWpcomAuth,
		prepare: async () => {
			if ( await hasValidWpcomAuth() ) {
				return;
			}

			throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
		},
		resolveEnv: async () => {
			const token = await getAuthToken();
			const env = createBaseEnvironment();
			env.ANTHROPIC_BASE_URL = getWpcomAiGatewayBaseUrl();
			env.ANTHROPIC_AUTH_TOKEN = token.accessToken;
			env.ANTHROPIC_CUSTOM_HEADERS = buildAnthropicCustomHeaders( {
				'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER,
			} );
			env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
			return env;
		},
	},
	'anthropic-claude': {
		id: 'anthropic-claude',
		autoFallbackWhenUnavailable: true,
		isVisible: async () => hasClaudeCodeAuth(),
		isReady: async () => hasClaudeCodeAuth(),
		prepare: async () => {
			if ( hasClaudeCodeAuth() ) {
				return;
			}

			throw new LoggerError(
				__( 'Claude auth is not available. Choose another provider with /provider.' )
			);
		},
		resolveEnv: async () => {
			if ( ! hasClaudeCodeAuth() ) {
				throw new LoggerError(
					__( 'Claude auth is not available. Choose another provider with /provider.' )
				);
			}

			return createBaseEnvironment();
		},
	},
	'anthropic-api-key': {
		id: 'anthropic-api-key',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => Boolean( await getAnthropicApiKey() ),
		prepare: async () => {
			await resolveAnthropicApiKey();
		},
		resolveEnv: async () => {
			const apiKey = await getAnthropicApiKey();
			if ( ! apiKey ) {
				throw new LoggerError(
					__(
						'Anthropic API key required. Switch to Anthropic · API key with /provider to save one.'
					)
				);
			}

			const env = createBaseEnvironment();
			env.ANTHROPIC_API_KEY = apiKey;
			return env;
		},
	},
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
