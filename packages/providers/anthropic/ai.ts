import { NotConnectedError } from '../errors';
import { anthropicCatalog } from './catalog';
import type { AnthropicConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

export const anthropicAi: NonNullable< ProviderServices< AnthropicConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Anthropic with an API key or a Claude subscription.' );
		}
		// pi's model carries the thinking fields (`compat.forceAdaptiveThinking`) current Claude
		// models need, or they reject the request with a 400.
		const model = anthropicCatalog.run( modelId );
		if ( ! model ) {
			throw new Error( `Anthropic does not serve ${ modelId }` );
		}
		return {
			piProvider: 'anthropic',
			// pi switches to Bearer auth for a subscription token on its own.
			apiKey: config.method === 'api-key' ? config.apiKey : config.token,
			model,
		};
	},
	listModels: anthropicCatalog.listModels,
	selectModels: anthropicCatalog.selectModels,
};
