import { input, password } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { ensureOpenAiCompatibleGateway } from 'cli/ai/openai-compat-gateway';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
	'openai-compatible': 'OpenAI-compatible',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';
export const AI_PROVIDER_PRIORITY: AiProviderId[] = [
	'wpcom',
	'anthropic-api-key',
	'openai-compatible',
];

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const WPCOM_AI_FEATURE_HEADER = 'studio-assistant-anthropic';

export interface AiProviderDefinition {
	id: AiProviderId;
	autoFallbackWhenUnavailable: boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: ( options?: { force?: boolean } ) => Promise< void >;
	resolveEnv: () => Promise< Record< string, string > >;
}

async function resolveAnthropicApiKey( options?: {
	force?: boolean;
} ): Promise< string | undefined > {
	const { anthropicApiKey: savedKey } = await readCliConfig();
	if ( savedKey && ! options?.force ) {
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

	await updateCliConfigWithPartial( { anthropicApiKey: apiKey } );
	return apiKey;
}

interface OpenAiCompatibleProviderConfig {
	baseUrl: string;
	apiKey?: string;
	model: string;
}

async function resolveOpenAiCompatibleProviderConfig( options?: {
	force?: boolean;
} ): Promise< OpenAiCompatibleProviderConfig > {
	const {
		openAiCompatibleBaseUrl: savedBaseUrl,
		openAiCompatibleApiKey: savedApiKey,
		openAiCompatibleModel: savedModel,
	} = await readCliConfig();

	if ( savedBaseUrl && savedModel && ! options?.force ) {
		return { baseUrl: savedBaseUrl, apiKey: savedApiKey, model: savedModel };
	}

	const baseUrl = await input( {
		message: __( 'Enter the OpenAI-compatible base URL (e.g. http://localhost:11435/v1):' ),
		default: savedBaseUrl,
		validate: ( value ) => {
			if ( ! value.trim() ) {
				return __( 'Base URL is required' );
			}
			return true;
		},
	} );

	const apiKey = await password( {
		message: __( 'Enter an API key, if required (leave blank if none):' ),
		mask: '*',
	} );

	const model = await input( {
		message: __( 'Enter the model name (e.g. qwen3.6-27b):' ),
		default: savedModel,
		validate: ( value ) => {
			if ( ! value.trim() ) {
				return __( 'Model name is required' );
			}
			return true;
		},
	} );

	const config: OpenAiCompatibleProviderConfig = {
		baseUrl: baseUrl.trim(),
		apiKey: apiKey.trim() || undefined,
		model: model.trim(),
	};

	await updateCliConfigWithPartial( {
		openAiCompatibleBaseUrl: config.baseUrl,
		openAiCompatibleApiKey: config.apiKey,
		openAiCompatibleModel: config.model,
	} );

	return config;
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
	const token = await readAuthToken();
	return token !== null;
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
			const token = await readAuthToken();
			if ( ! token ) {
				throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
			}
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
	'anthropic-api-key': {
		id: 'anthropic-api-key',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => {
			const { anthropicApiKey } = await readCliConfig();
			return Boolean( anthropicApiKey );
		},
		prepare: async ( options ) => {
			await resolveAnthropicApiKey( options );
		},
		resolveEnv: async () => {
			const { anthropicApiKey: apiKey } = await readCliConfig();
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
	'openai-compatible': {
		id: 'openai-compatible',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => {
			const { openAiCompatibleBaseUrl, openAiCompatibleModel } = await readCliConfig();
			return Boolean( openAiCompatibleBaseUrl && openAiCompatibleModel );
		},
		prepare: async ( options ) => {
			await resolveOpenAiCompatibleProviderConfig( options );
		},
		resolveEnv: async () => {
			const {
				openAiCompatibleBaseUrl: baseUrl,
				openAiCompatibleApiKey: apiKey,
				openAiCompatibleModel: model,
			} = await readCliConfig();

			if ( ! baseUrl || ! model ) {
				throw new LoggerError(
					__(
						'OpenAI-compatible endpoint not configured. Switch to OpenAI-compatible with /provider to set one up.'
					)
				);
			}

			const gateway = await ensureOpenAiCompatibleGateway( { baseUrl, apiKey, model } );

			const env = createBaseEnvironment();
			env.ANTHROPIC_BASE_URL = gateway.url;
			env.ANTHROPIC_AUTH_TOKEN = 'local-openai-compatible-gateway';
			env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
			return env;
		},
	},
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
