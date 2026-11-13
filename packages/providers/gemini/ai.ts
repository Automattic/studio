import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
import { NotConnectedError } from '../errors';
import { GEMINI_AI_MODELS } from './descriptor';
import type { GeminiConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

export const geminiAi: NonNullable< ProviderServices< GeminiConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect Google Gemini with an API key.' );
		}
		const model =
			GEMINI_AI_MODELS.some( ( { id } ) => id === modelId ) &&
			GOOGLE_MODELS[ modelId as keyof typeof GOOGLE_MODELS ];
		if ( ! model ) {
			throw new Error( `Google Gemini does not serve ${ modelId }` );
		}
		return {
			piProvider: 'google',
			apiKey: config.apiKey,
			model: {
				...model,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
};
