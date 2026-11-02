import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import {
	aiModelSupportsImages,
	getAiModel,
	type AiModelFamily,
	type AiModelId,
} from '@studio/agent/protocol/models';
import { withLeakedToolCallMarkupRemoved } from './runtime-guards/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from './runtime-guards/strip-stale-images';
import { withUsageCapErrorRewrite } from './runtime-guards/usage-cap';
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';

export type StudioModel =
	| Model< 'openai-completions' >
	| Model< 'openai-responses' >
	| Model< 'anthropic-messages' >;

const STUDIO_WPCOM_PROVIDER = 'studio-wpcom';

// pi's stock stream for the model's API, with the usage-cap 429 rewrite, the
// leaked tool-call cleanup, and stale screenshots stripped, which would
// otherwise bloat requests past the proxy's body limit.
export function streamStudioModel(
	model: Model< Api >,
	context: Context,
	options?: SimpleStreamOptions
) {
	// Each API's stream function is narrower than `Model< Api >`; the model is
	// the one its API's function expects.
	const stream = (
		model.api === 'openai-completions'
			? streamOpenAiCompletions
			: model.api === 'anthropic-messages'
			? streamAnthropicMessages
			: streamOpenAiResponses
	) as typeof streamOpenAiCompletions;
	// The model keeps its stable id for pi and the session history; only the
	// request names the proxy's current upstream alias.
	const apiModelId = getAiModel( model.id as AiModelId )?.apiModelId;
	return withUsageCapErrorRewrite(
		withLeakedToolCallMarkupRemoved(
			stream( model as Model< 'openai-completions' >, stripStaleImagesFromContext( context ), {
				...options,
				...( apiModelId
					? {
							onPayload: async ( params: unknown, payloadModel: Model< Api > ) => {
								const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
								return { ...( next as Record< string, unknown > ), model: apiModelId };
							},
					  }
					: {} ),
			} )
		)
	);
}

// The model pi calls for a Studio model id: a WordPress.com capability tier
// through the AI proxy, or an Anthropic model with the user's key.
export function buildStudioModel(
	modelId: AiModelId,
	family: AiModelFamily,
	creds: { apiKey: string; baseUrl: string; headers?: Record< string, string > }
): StudioModel {
	const baseUrl = creds.baseUrl.replace( /\/+$/, '' );
	const common = {
		id: modelId,
		name: modelId,
		baseUrl,
		input: aiModelSupportsImages( modelId )
			? [ 'text' as const, 'image' as const ]
			: [ 'text' as const ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...( creds.headers ? { headers: creds.headers } : {} ),
	};

	if ( family === 'studio' ) {
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
				headers: { ...creds.headers, Authorization: `Bearer ${ creds.apiKey }` },
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
	}
	// Without `compat.forceAdaptiveThinking` pi-ai sends the legacy
	// `thinking: { type: 'enabled', budget_tokens }` shape, which Sonnet 5 /
	// Opus 5 reject with a 400 — copy the thinking fields from pi's catalog.
	const catalogModel = (
		ANTHROPIC_MODELS as Partial< Record< string, Model< 'anthropic-messages' > > >
	 )[ modelId ];
	return {
		...common,
		api: 'anthropic-messages',
		provider: 'anthropic',
		reasoning: true,
		// contextWindow/maxTokens intentionally stay below the catalog values.
		contextWindow: 200_000,
		// thinkingLevel 'high' reserves ~16384 of this budget for extended thinking
		// (see adjustMaxTokensForThinking in pi-ai); keep enough headroom for visible
		// output so single tool calls can emit a full-page HTML payload.
		maxTokens: 32_000,
		...( catalogModel?.thinkingLevelMap
			? { thinkingLevelMap: catalogModel.thinkingLevelMap }
			: {} ),
		...( catalogModel?.compat ? { compat: catalogModel.compat } : {} ),
	};
}
