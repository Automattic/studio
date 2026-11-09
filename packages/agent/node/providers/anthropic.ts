import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { validateAnthropicApiKey } from './anthropic-key';
import type { AiProvider } from './types';
import type { Model } from '@earendil-works/pi-ai';

export const anthropicProvider = {
	auth: {
		type: 'api-key',
		validate: validateAnthropicApiKey,
	},
	buildModel( modelId, creds, { supportsImages } ) {
		// Without `compat.forceAdaptiveThinking` pi-ai sends the legacy
		// `thinking: { type: 'enabled', budget_tokens }` shape, which Sonnet 5 /
		// Opus 5 reject with a 400 — copy the thinking fields from pi's catalog.
		const catalogModel = (
			ANTHROPIC_MODELS as Partial< Record< string, Model< 'anthropic-messages' > > >
		 )[ modelId ];
		return {
			id: modelId,
			name: modelId,
			baseUrl: creds.baseURL.replace( /\/+$/, '' ),
			input: supportsImages ? [ 'text', 'image' ] : [ 'text' ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...( creds.extraHeaders ? { headers: creds.extraHeaders } : {} ),
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
	},
	async configureRuntime( runtime, _model, creds ) {
		await runtime.setRuntimeApiKey( 'anthropic', creds.apiKey );
	},
} satisfies AiProvider;
