import { password } from '@inquirer/prompts';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	type AiModelFamily,
	type AiModelId,
	type SelectedModelId,
} from '@studio/common/ai/models';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import {
	discoverOpenAiCompatibleModels,
	resolveOpenAiCompatibleContextWindow,
} from 'cli/ai/openai-compatible';
import {
	getActiveOpenAiCompatibleEndpoint,
	readCliConfig,
	updateCliConfigWithPartial,
} from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
	'openai-compatible': 'OpenAI-compatible',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

// Fallback context window for a local model whose window can't be discovered.
const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 8192;

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';
export const AI_PROVIDER_PRIORITY: AiProviderId[] = [
	'wpcom',
	'anthropic-api-key',
	'openai-compatible',
];

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
	readonly defaultModel: SelectedModelId;
	supportsModel( model: SelectedModelId ): boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: ( options?: { force?: boolean } ) => Promise< void >;
	resolveEnv: ( options?: ResolveAiEnvironmentOptions ) => Promise< Record< string, string > >;
	/**
	 * Providers whose models are discovered at runtime (e.g. `openai-compatible`,
	 * which lists a local endpoint's `/v1/models`) implement this so the `/model`
	 * picker can offer real models instead of the fixed `AI_MODELS` list. Absent
	 * on providers backed by the built-in catalog.
	 */
	listDynamicModels?: () => Promise< { id: string; contextWindow?: number }[] >;
	/**
	 * The model to select when switching to this provider, for providers with
	 * dynamic models (the saved selection, or the first discovered model).
	 */
	resolveDefaultModel?: () => Promise< SelectedModelId | undefined >;
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
			return availableModels.includes( model as AiModelId );
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
	delete env.STUDIO_OPENAI_COMPLETIONS;
	delete env.STUDIO_OPENAI_COMPLETIONS_CONTEXT_WINDOW;

	return env;
}

const OPENAI_COMPATIBLE_NOT_CONFIGURED = __(
	'OpenAI-compatible endpoint not configured. Use /openai-config to set one up.'
);

async function resolveOpenAiCompatibleEndpointOrThrow() {
	const endpoint = await getActiveOpenAiCompatibleEndpoint();
	if ( ! endpoint?.baseUrl ) {
		throw new LoggerError( OPENAI_COMPATIBLE_NOT_CONFIGURED );
	}
	return endpoint;
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
	'openai-compatible': {
		id: 'openai-compatible',
		autoFallbackWhenUnavailable: false,
		// Routes through the pi `openai` family (OPENAI_* credentials); the
		// runtime switches to the chat/completions wire flavor via the env
		// markers set in resolveEnv below.
		supportedModelFamilies: [ 'openai' ],
		// Models are discovered from the endpoint, not the built-in catalog.
		availableModels: [],
		defaultModel: DEFAULT_MODEL,
		// Owns any id that isn't a built-in model (i.e. a local endpoint model).
		supportsModel: ( model ) =>
			! ( AI_MODELS as readonly { id: string }[] ).some( ( m ) => m.id === model ),
		isVisible: async () => true,
		isReady: async () => {
			const endpoint = await getActiveOpenAiCompatibleEndpoint();
			return Boolean( endpoint?.baseUrl && endpoint?.selectedModel );
		},
		prepare: async () => {
			// Configuration is interactive via the /openai-config slash command;
			// nothing to prepare non-interactively here.
			await resolveOpenAiCompatibleEndpointOrThrow();
		},
		resolveEnv: async () => {
			const endpoint = await resolveOpenAiCompatibleEndpointOrThrow();
			if ( ! endpoint.selectedModel ) {
				throw new LoggerError(
					__( 'No OpenAI-compatible model selected. Use /model to choose one.' )
				);
			}

			const contextWindow =
				( await resolveOpenAiCompatibleContextWindow(
					endpoint.baseUrl,
					endpoint.apiKey,
					endpoint.selectedModel,
					endpoint.contextWindow
				) ) ?? DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW;

			const env = createBaseEnvironment();
			env.OPENAI_BASE_URL = endpoint.baseUrl;
			// pi's openai family requires a non-empty key; local servers usually
			// ignore it, so default to a placeholder when none is configured.
			env.OPENAI_API_KEY = endpoint.apiKey || 'local';
			env.STUDIO_OPENAI_COMPLETIONS = '1';
			env.STUDIO_OPENAI_COMPLETIONS_CONTEXT_WINDOW = String( contextWindow );
			return env;
		},
		listDynamicModels: async () => {
			const endpoint = await getActiveOpenAiCompatibleEndpoint();
			if ( ! endpoint?.baseUrl ) {
				return [];
			}
			return discoverOpenAiCompatibleModels( endpoint.baseUrl, endpoint.apiKey );
		},
		resolveDefaultModel: async () => {
			const endpoint = await getActiveOpenAiCompatibleEndpoint();
			if ( endpoint?.selectedModel ) {
				return endpoint.selectedModel;
			}
			if ( ! endpoint?.baseUrl ) {
				return undefined;
			}
			const models = await discoverOpenAiCompatibleModels( endpoint.baseUrl, endpoint.apiKey );
			return models[ 0 ]?.id;
		},
	},
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
