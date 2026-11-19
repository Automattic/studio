import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { NotConnectedError } from '../errors';
import { ANTHROPIC_AI_MODELS } from './descriptor';
import type { AnthropicConfig } from './config';
import type { AiConnection, AiModel, ProviderServices } from '../types';
import type { Model } from '@earendil-works/pi-ai';

export const anthropicAi: NonNullable< ProviderServices< AnthropicConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Anthropic with an API key or a Claude subscription.' );
		}
		const model: AiModel | undefined = ANTHROPIC_AI_MODELS.find( ( { id } ) => id === modelId );
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
			// pi switches to Bearer auth for a subscription token on its own.
			apiKey: config.method === 'api-key' ? config.apiKey : config.token,
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
