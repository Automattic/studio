import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { ProviderNotReadyError } from '../errors';
import { getAiModel } from '../models';
import type { AnthropicConfig } from './config';
import type { AiConnection, Provider } from '../types';
import type { Model } from '@earendil-works/pi-ai';

export const anthropicAi: NonNullable< Provider< AnthropicConfig >[ 'ai' ] > = {
	fallbackWhenNotReady: false,
	async connect( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new ProviderNotReadyError(
				'Anthropic API key required. Switch to Anthropic API with /provider to save one.'
			);
		}
		const model = getAiModel( 'anthropic', modelId );
		if ( ! model ) {
			throw new Error( `Anthropic does not serve ${ modelId }` );
		}
		// Without `compat.forceAdaptiveThinking` pi sends the legacy thinking
		// shape, which current Claude models reject with a 400, so the
		// thinking fields come from pi's catalog.
		const catalogModel = (
			ANTHROPIC_MODELS as Partial< Record< string, Model< 'anthropic-messages' > > >
		 )[ modelId ];
		return {
			piProvider: 'anthropic',
			apiKey: config.apiKey,
			model: {
				id: modelId,
				name: modelId,
				api: 'anthropic-messages',
				provider: 'anthropic',
				baseUrl: 'https://api.anthropic.com',
				reasoning: true,
				input: model.supportsImages === false ? [ 'text' ] : [ 'text', 'image' ],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Intentionally below the catalog values. Thinking reserves part of
				// `maxTokens`; keep enough headroom for visible output so single tool
				// calls can emit a full-page HTML payload.
				contextWindow: 200_000,
				maxTokens: 32_000,
				...( catalogModel?.thinkingLevelMap
					? { thinkingLevelMap: catalogModel.thinkingLevelMap }
					: {} ),
				...( catalogModel?.compat ? { compat: catalogModel.compat } : {} ),
			},
		};
	},
};
