import { password } from '@inquirer/prompts';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	type AiModelFamily,
	type AiModelId,
} from '@studio/common/ai/models';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';
export const AI_PROVIDER_PRIORITY: AiProviderId[] = [ 'wpcom', 'anthropic-api-key' ];

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
// The wpcom AI proxy maps feature slugs to upstream providers. Historically
// `studio-assistant` was wired for OpenAI (OPENAI_TOKEN); when Claude support
// landed a parallel `studio-assistant-anthropic` slug was added. Keep using
// the existing slugs so no server-side allowlist change is required.
const WPCOM_AI_FEATURE_HEADER_ANTHROPIC = 'studio-assistant-anthropic';
const WPCOM_AI_FEATURE_HEADER_OPENAI = 'studio-assistant';

export interface ResolveAiEnvironmentOptions {
	sessionId?: string;
}

export interface AiProviderDefinition {
	id: AiProviderId;
	autoFallbackWhenUnavailable: boolean;
	/**
	 * Which model families this provider can service. `wpcom` relays both
	 * Anthropic and OpenAI wire formats through the same proxy; direct-API
	 * providers are restricted to their own family. `availableModels` and
	 * `defaultModel` are derived from this and kept on the definition so
	 * callers don't have to filter AI_MODELS themselves.
	 */
	readonly supportedModelFamilies: readonly AiModelFamily[];
	readonly availableModels: readonly AiModelId[];
	readonly defaultModel: AiModelId;
	supportsModel( model: AiModelId ): boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: ( options?: { force?: boolean } ) => Promise< void >;
	resolveEnv: ( options?: ResolveAiEnvironmentOptions ) => Promise< Record< string, string > >;
}

/**
 * Fills in `availableModels`, `defaultModel`, and `supportsModel` from the
 * declared `supportedModelFamilies` so each provider literal below only has to
 * state its family allowlist.
 */
function defineProvider(
	partial: Omit< AiProviderDefinition, 'availableModels' | 'defaultModel' | 'supportsModel' >
): AiProviderDefinition {
	const availableModels: AiModelId[] = AI_MODELS.filter( ( model ) =>
		partial.supportedModelFamilies.includes( model.family )
	).map( ( model ) => model.id );
	return {
		...partial,
		availableModels,
		defaultModel: availableModels[ 0 ] ?? DEFAULT_MODEL,
		supportsModel( model ) {
			return availableModels.includes( model );
		},
	};
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

function getStudioUserAgent(): string {
	const version = typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : '';
	return version ? `WordPressStudio/${ version }` : 'WordPressStudio';
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

function readInlineWpcomToken(): string | null {
	return process.env.STUDIO_WPCOM_TOKEN?.trim() || null;
}

export function hasInlineWpcomAuth(): boolean {
	return readInlineWpcomToken() !== null;
}

function createBaseEnvironment(): Record< string, string > {
	const env = { ...( process.env as Record< string, string > ) };

	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_CUSTOM_HEADERS;
	delete env.OPENAI_API_KEY;
	delete env.OPENAI_BASE_URL;
	delete env.STUDIO_OPENAI_DEFAULT_HEADERS;

	return env;
}

const AI_PROVIDER_DEFINITIONS: Record< AiProviderId, AiProviderDefinition > = {
	wpcom: defineProvider( {
		id: 'wpcom',
		autoFallbackWhenUnavailable: true,
		supportedModelFamilies: [ 'anthropic', 'openai' ],
		isVisible: async () => true,
		isReady: async () => hasInlineWpcomAuth() || ( await hasValidWpcomAuth() ),
		prepare: async () => {
			if ( hasInlineWpcomAuth() || ( await hasValidWpcomAuth() ) ) {
				return;
			}

			throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
		},
		resolveEnv: async ( options ) => {
			const inlineToken = readInlineWpcomToken();
			const accessToken = inlineToken ?? ( await readAuthToken() )?.accessToken;
			if ( ! accessToken ) {
				throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
			}
			const env = createBaseEnvironment();
			const gatewayBaseUrl = getWpcomAiGatewayBaseUrl();

			// Anthropic messages path through the WP.com AI gateway.
			env.ANTHROPIC_BASE_URL = gatewayBaseUrl;
			env.ANTHROPIC_AUTH_TOKEN = accessToken;
			const anthropicHeaders: Record< string, string > = {
				'User-Agent': getStudioUserAgent(),
				'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER_ANTHROPIC,
			};
			if ( options?.sessionId ) {
				anthropicHeaders[ 'X-WPCOM-Session-ID' ] = options.sessionId;
			}
			env.ANTHROPIC_CUSTOM_HEADERS = buildAnthropicCustomHeaders( anthropicHeaders );

			// OpenAI Responses path. The wpcom proxy accepts the same bearer token and
			// dispatches to the right upstream based on the request path.
			// The OpenAI SDK expects baseURL to include /v1 (like the real
			// OpenAI API), so the request path becomes /v1/responses —
			// mirroring the Anthropic path's /v1/messages.
			env.OPENAI_BASE_URL = `${ gatewayBaseUrl.replace( /\/+$/, '' ) }/v1`;
			env.OPENAI_API_KEY = accessToken;
			const openaiHeaders: Record< string, string > = {
				'User-Agent': getStudioUserAgent(),
				'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER_OPENAI,
			};
			if ( options?.sessionId ) {
				openaiHeaders[ 'X-WPCOM-Session-ID' ] = options.sessionId;
			}
			env.STUDIO_OPENAI_DEFAULT_HEADERS = JSON.stringify( openaiHeaders );

			return env;
		},
	} ),
	'anthropic-api-key': defineProvider( {
		id: 'anthropic-api-key',
		autoFallbackWhenUnavailable: false,
		supportedModelFamilies: [ 'anthropic' ],
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
	} ),
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
