import { validateAnthropicApiKey } from '@studio/common/ai/anthropic-key';
import { DEFAULT_MODEL, toCustomModelId, type AiModelId } from '@studio/common/ai/models';
import {
	AI_PROVIDER_IDS,
	DEFAULT_AI_PROVIDER,
	getAiProviderModels,
	providerServesModel,
	type AiProviderId,
} from '@studio/common/ai/providers';
import {
	persistAnthropicApiKey,
	persistCustomEndpoint,
	readAnthropicApiKey,
	readCustomEndpoint,
} from '@studio/common/ai/settings-store';
import { readAuthToken, type CustomEndpoint } from '@studio/common/lib/shared-config';
import { __, sprintf } from '@wordpress/i18n';
import { confirm, input, password } from 'cli/lib/prompts';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS: Record< AiProviderId, string > = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
	'custom-endpoint': 'Custom endpoint',
};

export type { AiProviderId };
export { DEFAULT_AI_PROVIDER };
// Fallback order when the configured provider is unavailable; declaration
// order of the canonical id list.
export const AI_PROVIDER_PRIORITY: readonly AiProviderId[] = AI_PROVIDER_IDS;

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
	// The models it offers, the first being its default: those of its model
	// families (see `@studio/common/ai/providers`), or for the custom endpoint
	// the ones its connection names.
	getModels(): Promise< readonly AiModelId[] >;
	supportsModel( model: AiModelId ): boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: ( options?: { force?: boolean } ) => Promise< void >;
	resolveEnv: ( options?: ResolveAiEnvironmentOptions ) => Promise< Record< string, string > >;
}

// Fills in `getModels` (unless given) and `supportsModel` from the provider
// id's model families.
function defineProvider(
	partial: Omit< AiProviderDefinition, 'getModels' | 'supportsModel' > &
		Partial< Pick< AiProviderDefinition, 'getModels' > >
): AiProviderDefinition {
	const familyModels = getAiProviderModels( partial.id ).map( ( model ) => model.id );
	return {
		getModels: async () => familyModels,
		...partial,
		supportsModel( model ) {
			return providerServesModel( partial.id, model );
		},
	};
}

/** The model a provider falls back to: the first it offers. */
export async function getProviderDefaultModel(
	definition: AiProviderDefinition
): Promise< AiModelId > {
	return ( await definition.getModels() )[ 0 ] ?? DEFAULT_MODEL;
}

// The APIs a custom endpoint may speak, in the order the connect check tries
// them: Chat Completions first, as nearly every gateway and local server takes
// it. Each is given the URL as the user entered it, except that Anthropic
// Messages appends `/v1/messages` itself.
const CUSTOM_ENDPOINT_APIS: ReadonlyArray< {
	api: CustomEndpoint[ 'api' ];
	baseUrl: ( url: string ) => string;
} > = [
	{ api: 'openai-completions', baseUrl: ( url ) => url },
	{ api: 'anthropic-messages', baseUrl: ( url ) => url.replace( /\/v1$/, '' ) },
];

// Asks where the endpoint is, its key, its models and whether they take
// images, then sends the first model a short request the way a turn does, in
// each API until one answers. Only a connection that answers is saved, with
// the API it answered in.
async function connectCustomEndpoint(): Promise< void > {
	const url = (
		await input( {
			message: __( 'Endpoint URL (e.g. https://openrouter.ai/api/v1):' ),
			validate: ( value ) => URL.canParse( value.trim() ) || __( 'Enter a full URL.' ),
		} )
	)
		.trim()
		.replace( /\/+$/, '' );
	const apiKey = (
		await password( {
			message: __( 'API key (will be saved for future use):' ),
			mask: '*',
			validate: ( value ) => Boolean( value.trim() ) || __( 'API key is required' ),
		} )
	).trim();
	const models = (
		await input( {
			message: __( 'Model names, separated by commas (the first is the default):' ),
			validate: ( value ) => Boolean( value.trim() ) || __( 'Name at least one model.' ),
		} )
	)
		.split( ',' )
		.map( ( name ) => name.trim() )
		.filter( Boolean );
	const images = await confirm( { message: __( 'Do these models take images?' ), default: true } );

	const { checkCustomEndpoint } = await import( 'cli/ai/runtimes/pi' );
	const failures: string[] = [];
	for ( const candidate of CUSTOM_ENDPOINT_APIS ) {
		const endpoint: CustomEndpoint = {
			baseUrl: candidate.baseUrl( url ),
			api: candidate.api,
			apiKey,
			models,
			images,
		};
		const failure = await checkCustomEndpoint( endpoint, toCustomModelId( models[ 0 ] ) );
		if ( ! failure ) {
			await persistCustomEndpoint( endpoint );
			return;
		}
		failures.push( failure );
	}
	throw new LoggerError(
		sprintf(
			/* translators: 1: model name, 2: the endpoint's errors, one per API tried */
			__( 'The endpoint did not answer for %1$s, so it was not saved: %2$s' ),
			models[ 0 ],
			failures.join( ' / ' )
		)
	);
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
	delete env.STUDIO_CUSTOM_ENDPOINT;

	return env;
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
	'custom-endpoint': defineProvider( {
		id: 'custom-endpoint',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => Boolean( await readCustomEndpoint() ),
		getModels: async () => ( await readCustomEndpoint() )?.models.map( toCustomModelId ) ?? [],
		// A connected endpoint is kept unless the user asks to connect another.
		prepare: async ( options ) => {
			const saved = await readCustomEndpoint();
			if (
				saved &&
				! options?.force &&
				( await confirm( {
					message: sprintf(
						/* translators: %s: the endpoint's URL */
						__( 'Keep the endpoint at %s?' ),
						saved.baseUrl
					),
					default: true,
				} ) )
			) {
				return;
			}
			await connectCustomEndpoint();
		},
		resolveEnv: async () => {
			const endpoint = await readCustomEndpoint();
			if ( ! endpoint ) {
				throw new LoggerError(
					__( 'No custom endpoint is connected. Connect one with /provider.' )
				);
			}
			const env = createBaseEnvironment();
			env.STUDIO_CUSTOM_ENDPOINT = JSON.stringify( endpoint );
			return env;
		},
	} ),
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
