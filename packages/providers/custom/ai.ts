import { NotConnectedError } from '../errors';
import { PORTABLE_COMPLETIONS_COMPAT } from '../openai-compat';
import type { CustomConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

// Neither is known for an endpoint's model, so both are a floor most models clear.
const LIMITS = { contextWindow: 128_000, maxTokens: 32_000 };

// The connected endpoint's model, in the API it answered in. The model keeps
// Studio's id; only the request names it as the endpoint does.
export function customConnection( config: CustomConfig ): AiConnection {
	return {
		piProvider: 'studio-custom',
		apiKey: config.apiKey,
		requestModelId: config.model,
		model: {
			id: 'custom',
			name: config.model,
			api: config.api,
			provider: 'studio-custom',
			baseUrl: config.baseUrl,
			reasoning: true,
			input: config.images ? [ 'text', 'image' ] : [ 'text' ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			...LIMITS,
			...( config.api === 'openai-completions' ? { compat: PORTABLE_COMPLETIONS_COMPAT } : {} ),
		},
	};
}

export const customAi: NonNullable< ProviderServices< CustomConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'No custom endpoint is connected.' );
		}
		if ( modelId !== 'custom' ) {
			throw new Error( `The custom endpoint does not serve ${ modelId }` );
		}
		return customConnection( config );
	},
};
