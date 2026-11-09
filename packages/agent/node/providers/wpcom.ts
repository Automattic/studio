import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { getAiModel } from '@studio/agent/protocol/models';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, sprintf } from '@wordpress/i18n';
import { getWpcomAiGatewayBaseUrl } from '../ai-gateway';
import { withLeakedToolCallMarkupRemoved } from '../runtime/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from '../runtime/strip-stale-images';
import { withUsageCapErrorRewrite } from '../runtime/usage-cap';
import { InvalidAiProviderCredentialsError } from './types';
import type { StudioAiProvider } from './index';
import type { ProviderCredentials, RuntimeModel } from './types';
import type { SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AiModelId } from '@studio/agent/protocol/models';

type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];
const STUDIO_WPCOM_PROVIDER = 'studio-wpcom';

export const wpcomProvider: StudioAiProvider = {
	environmentKeys: [
		'STUDIO_WPCOM_API_KEY',
		'STUDIO_WPCOM_BASE_URL',
		'STUDIO_WPCOM_DEFAULT_HEADERS',
	],
	auth: { type: 'account', isConnected: async () => Boolean( await readAuthToken() ) },
	autoFallbackWhenUnavailable: true,
	isPreferred: () => Boolean( process.env.STUDIO_WPCOM_TOKEN?.trim() ),
	connect: async ( login ) => {
		await login();
		return Boolean( process.env.STUDIO_WPCOM_TOKEN?.trim() || ( await readAuthToken() ) );
	},
	getConnectionMessages: async () => {
		const token = await readAuthToken();
		return token
			? {
					status: sprintf(
						/* translators: %s: user display name */
						__( 'Logged in as %s' ),
						token.displayName
					),
					success: sprintf(
						/* translators: 1: display name, 2: email */
						__( 'Logged in as %1$s (%2$s)' ),
						token.displayName,
						token.email
					),
			  }
			: { status: __( 'Use /login to authenticate to WordPress.com' ) };
	},
	async resolveEnv( { sessionId, userAgent } ) {
		const accessToken =
			process.env.STUDIO_WPCOM_TOKEN?.trim() || ( await readAuthToken() )?.accessToken;
		if ( ! accessToken ) {
			throw new InvalidAiProviderCredentialsError(
				__( 'WordPress.com login required. Use /login to authenticate.' )
			);
		}
		const headers: Record< string, string > = {
			'User-Agent': userAgent,
			'X-WPCOM-AI-Feature': 'studio-agent',
		};
		if ( sessionId ) headers[ 'X-WPCOM-Session-ID' ] = sessionId;
		return {
			STUDIO_WPCOM_BASE_URL: `${ getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' ) }/v1`,
			STUDIO_WPCOM_API_KEY: accessToken,
			STUDIO_WPCOM_DEFAULT_HEADERS: JSON.stringify( headers ),
		};
	},
	resolveCredentials( env ) {
		const apiKey = env.STUDIO_WPCOM_API_KEY?.trim();
		if ( ! apiKey ) {
			return {
				ok: false,
				reason:
					'The WordPress.com models need a wpcom access token, and STUDIO_WPCOM_API_KEY is not set — run /login to authenticate.',
			};
		}
		const baseURL = env.STUDIO_WPCOM_BASE_URL?.trim();
		if ( ! baseURL ) {
			return { ok: false, reason: 'STUDIO_WPCOM_BASE_URL not set — cannot route to wpcom proxy.' };
		}
		return {
			ok: true,
			creds: {
				apiKey,
				baseURL,
				extraHeaders: parseJsonHeaderEnv(
					'STUDIO_WPCOM_DEFAULT_HEADERS',
					env.STUDIO_WPCOM_DEFAULT_HEADERS
				),
			},
		};
	},
	buildModel( modelId, creds, { supportsImages } ) {
		const baseUrl = creds.baseURL.replace( /\/+$/, '' );
		const common = {
			id: modelId,
			name: modelId,
			baseUrl,
			input: supportsImages
				? [ 'text' as const, 'image' as const ]
				: [ 'text' as const ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...( creds.extraHeaders ? { headers: creds.extraHeaders } : {} ),
		};
		// The capability tiers are resolved to upstream models by the wpcom
		// proxy. The context window is a conservative floor across the
		// upstreams a tier may resolve to, so compaction kicks in before any
		// of them overflows.
		//
		// `strong` rides the proxy's Anthropic Messages path, which sits beside
		// `/v1` rather than under it and authenticates with a bearer token.
		if ( modelId === 'strong' ) {
			return {
				...common,
				baseUrl: baseUrl.replace( /\/v1$/, '' ),
				headers: { ...creds.extraHeaders, Authorization: `Bearer ${ creds.apiKey }` },
				api: 'anthropic-messages',
				provider: STUDIO_WPCOM_PROVIDER,
				reasoning: false,
				contextWindow: 200_000,
				maxTokens: 32_000,
			};
		}
		// `balanced` rides the Responses path: its upstream is a reasoning model
		// that rejects tools-plus-reasoning on Chat Completions.
		if ( modelId === 'balanced' ) {
			return {
				...common,
				api: 'openai-responses',
				provider: STUDIO_WPCOM_PROVIDER,
				reasoning: true,
				contextWindow: 200_000,
				maxTokens: 32_000,
			};
		}
		// The other tiers speak Chat Completions. pi infers `compat` from the
		// base URL, which for us reads as plain OpenAI — so spell out the shape
		// or requests carry OpenAI-only fields other upstreams reject. With
		// `supportsReasoningEffort` false no thinking switch is sent at all and
		// each upstream uses its own default — the portable choice across
		// vendors that spell that parameter differently.
		return {
			...common,
			api: 'openai-completions',
			provider: STUDIO_WPCOM_PROVIDER,
			reasoning: true,
			contextWindow: 200_000,
			maxTokens: 32_000,
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				supportsStrictMode: false,
				maxTokensField: 'max_tokens',
			},
		};
	},
	configureRuntime( runtime, model, creds ) {
		runtime.registerProvider( model.provider, createWpcomProviderConfig( model, creds ) );
	},
};

// pi (>= 0.78) parses `registerProvider` config values (apiKey, headers) as
// templates: a `$NAME` / `${NAME}` sequence is read as an environment-variable
// reference and a leading `!` is read as a shell command. wpcom OAuth tokens are
// random strings that can contain `$` followed by a name-like sequence, so pi
// resolves that fragment to an undefined env var and treats the provider as
// unauthenticated ("No API key found for studio-wpcom-anthropic."). Escape the
// token so pi treats it as a literal: `$` -> `$$`, and a leading `!` -> `$!`.
function escapePiConfigValue( value: string ): string {
	const dollarEscaped = value.replace( /\$/g, () => '$$' );
	return dollarEscaped.startsWith( '!' ) ? `$${ dollarEscaped }` : dollarEscaped;
}

// The wpcom lane only needs pi's stock streaming for each tier's API; the
// custom provider exists to wrap the stream with the usage-cap 429 rewrite and
// the leaked tool-call cleanup, and to strip stale screenshots, which would
// otherwise bloat requests past the proxy's body limit.
function createWpcomProviderConfig(
	model: RuntimeModel,
	creds: ProviderCredentials
): ProviderConfigInput {
	// pi types `streamSimple` against `Model<Api>`; each API's stream function
	// is narrower, and the model registered below is the one passed in.
	const stream = (
		model.api === 'openai-completions'
			? streamOpenAiCompletions
			: model.api === 'anthropic-messages'
			? streamAnthropicMessages
			: streamOpenAiResponses
	) as NonNullable< ProviderConfigInput[ 'streamSimple' ] >;
	// The model keeps its stable id for pi and the session history; only the
	// request names the proxy's current upstream alias.
	const apiModelId = getAiModel( model.id as AiModelId )?.apiModelId;
	return {
		baseUrl: creds.baseURL,
		apiKey: escapePiConfigValue( creds.apiKey ),
		api: model.api,
		headers: creds.extraHeaders,
		streamSimple: ( m, ctx, options?: SimpleStreamOptions ) =>
			withUsageCapErrorRewrite(
				withLeakedToolCallMarkupRemoved(
					stream( m, stripStaleImagesFromContext( ctx ), {
						...options,
						...( apiModelId
							? {
									onPayload: async ( params: unknown, payloadModel ) => {
										const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
										return { ...( next as Record< string, unknown > ), model: apiModelId };
									},
							  }
							: {} ),
					} )
				)
			),
		models: [
			{
				id: model.id,
				name: model.name,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				headers: creds.extraHeaders,
				compat: model.compat,
			},
		],
	};
}

function parseJsonHeaderEnv(
	name: string,
	value: string | undefined
): Record< string, string > | undefined {
	if ( ! value ) return undefined;
	try {
		const parsed: unknown = JSON.parse( value );
		if ( parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ) {
			const entries = Object.entries( parsed as Record< string, unknown > ).filter(
				( [ , v ] ) => typeof v === 'string'
			) as [ string, string ][];
			return entries.length ? Object.fromEntries( entries ) : undefined;
		}
		console.warn(
			`${ name } must be a JSON object of string→string pairs; ignoring custom headers.`
		);
	} catch {
		console.warn( `${ name } contained malformed JSON; ignoring custom headers.` );
	}
	return undefined;
}
