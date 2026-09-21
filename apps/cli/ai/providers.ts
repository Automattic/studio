import { password } from '@inquirer/prompts';
import { validateAnthropicApiKey } from '@studio/common/ai/anthropic-key';
import {
	DEFAULT_MODEL,
	isAiModelId,
	type AiModelId,
	type SelectedModelId,
} from '@studio/common/ai/models';
import {
	AI_PROVIDER_IDS,
	DEFAULT_AI_PROVIDER,
	getAiProviderModels,
	type AiProviderId,
} from '@studio/common/ai/providers';
import { persistAnthropicApiKey, readAnthropicApiKey } from '@studio/common/ai/settings-store';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import {
	discoverOpenAiCompatibleModels,
	resolveOpenAiCompatibleContextWindow,
} from 'cli/ai/openai-compatible';
import { getActiveOpenAiCompatibleEndpoint } from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS: Record< AiProviderId, string > = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
	'openai-compatible': 'OpenAI-compatible',
};

export type { AiProviderId };
export { DEFAULT_AI_PROVIDER };
// Fallback order when the configured provider is unavailable; declaration
// order of the canonical id list.
export const AI_PROVIDER_PRIORITY: readonly AiProviderId[] = AI_PROVIDER_IDS;

// Fallback context window for a local model whose window can't be discovered.
const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 8192;

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
// The wpcom AI proxy maps feature slugs to upstream providers. The
// `studio-agent` lane accepts the capability-tier aliases (fast / balanced /
// strong) on the Chat Completions path and resolves each to an upstream
// model server-side.
const WPCOM_AI_FEATURE_HEADER = 'studio-agent';

export interface ResolveAiEnvironmentOptions {
	sessionId?: string;
}

export interface AiProviderDefinition {
	id: AiProviderId;
	autoFallbackWhenUnavailable: boolean;
	// Derived from the provider's model families (see
	// `@studio/common/ai/providers`), kept on the definition so callers don't
	// have to filter AI_MODELS themselves.
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

// Fills in `availableModels`, `defaultModel`, and `supportsModel` from the
// provider id's model families.
function defineProvider(
	partial: Omit< AiProviderDefinition, 'availableModels' | 'defaultModel' | 'supportsModel' >
): AiProviderDefinition {
	const availableModels = getAiProviderModels( partial.id ).map( ( model ) => model.id );
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
	const savedKey = await readAnthropicApiKey();
	if ( savedKey && ! options?.force ) {
		// Re-prompt only when Anthropic definitively rejects the saved key;
		// an unreachable API must not lock the user out of their provider.
		const validation = await validateAnthropicApiKey( savedKey );
		if ( validation.status !== 'invalid' ) {
			return savedKey;
		}
	}

	const apiKey = await password( {
		message: __( 'Enter your Anthropic API key (will be saved for future use):' ),
		mask: '*',
		validate: async ( value ) => {
			const trimmed = value.trim();
			if ( ! trimmed ) {
				return __( 'API key is required' );
			}
			const validation = await validateAnthropicApiKey( trimmed );
			return validation.status === 'invalid' ? validation.message : true;
		},
	} );

	const trimmedKey = apiKey.trim();
	await persistAnthropicApiKey( trimmedKey );
	return trimmedKey;
}

export function getStudioUserAgent(): string {
	const version = typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : '';
	return version ? `WordPressStudio/${ version }` : 'WordPressStudio';
}

export function getWpcomAiGatewayBaseUrl(): string {
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
	delete env.STUDIO_WPCOM_API_KEY;
	delete env.STUDIO_WPCOM_BASE_URL;
	delete env.STUDIO_WPCOM_DEFAULT_HEADERS;
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

			// The studio capability tiers speak the OpenAI Chat Completions
			// dialect, so the base URL carries the /v1 prefix (the request path
			// becomes /v1/chat/completions). The vars are Studio-namespaced
			// because this family has no direct-API provider — nothing but this
			// function should be able to satisfy it.
			env.STUDIO_WPCOM_BASE_URL = `${ gatewayBaseUrl.replace( /\/+$/, '' ) }/v1`;
			env.STUDIO_WPCOM_API_KEY = accessToken;
			const headers: Record< string, string > = {
				'User-Agent': getStudioUserAgent(),
				'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER,
			};
			if ( options?.sessionId ) {
				headers[ 'X-WPCOM-Session-ID' ] = options.sessionId;
			}
			env.STUDIO_WPCOM_DEFAULT_HEADERS = JSON.stringify( headers );

			return env;
		},
	} ),
	'anthropic-api-key': defineProvider( {
		id: 'anthropic-api-key',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => {
			return Boolean( await readAnthropicApiKey() );
		},
		prepare: async ( options ) => {
			await resolveAnthropicApiKey( options );
		},
		resolveEnv: async () => {
			const apiKey = await readAnthropicApiKey();
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
	// Declared literally rather than through `defineProvider`: its models come
	// from the endpoint at runtime, so the built-in catalog can't fill these in.
	// Routes through the pi `openai` family (OPENAI_* credentials); the runtime
	// switches to the chat/completions wire flavor via the env markers set in
	// resolveEnv below.
	'openai-compatible': {
		id: 'openai-compatible',
		autoFallbackWhenUnavailable: false,
		availableModels: [],
		defaultModel: DEFAULT_MODEL,
		// Owns any id that isn't a built-in model (i.e. a local endpoint model).
		supportsModel: ( model ) => ! isAiModelId( model ),
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
